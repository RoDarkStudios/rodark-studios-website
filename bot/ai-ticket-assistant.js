const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const MAX_HISTORY_MESSAGES = 15;
const MAX_IMAGE_INPUTS = 3;

const RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        action: {
            type: 'string',
            enum: ['reply', 'handoff', 'ignore']
        },
        reply: {
            type: 'string'
        },
        handoffReason: {
            type: 'string'
        }
    },
    required: ['action', 'reply', 'handoffReason']
};

const ASSISTANT_INSTRUCTIONS = [
    'You are the RoDark Studios AI Ticket Assistant.',
    'Your job is to briefly triage Discord support tickets and gather only the most important missing details.',
    'Be concise, direct, and useful. One short message is preferred. Two short sentences or a very short question list is the upper bound unless absolutely necessary.',
    'If the user has not explained the issue yet, reply with a short clarifying question instead of handing off.',
    'Lack of detail alone is not a reason to hand off.',
    'Only choose handoff when the user needs internal game knowledge, development context, account-specific investigation, moderation action, roadmap information, staff intervention, or when a human owner clearly needs to take over.',
    'Do not guess. Do not invent fixes. Do not promise outcomes. Do not mention policies, internal systems, or speculation.',
    'If the latest message does not appear to be from the person needing help, choose ignore.',
    'If the user already gave enough actionable diagnostic detail, ask at most the single most important next question.',
    'If the user only says hello, says they have a question, or asks for help without details, reply briefly asking what they need help with.',
    'If the user attached images, use them.',
    'Return JSON only that matches the provided schema.'
].join(' ');

function normalizeMessageText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isVagueOpeningMessage(messageText) {
    const normalized = normalizeMessageText(messageText);
    if (!normalized) {
        return true;
    }

    const words = normalized.split(' ').filter(Boolean);
    const hasGreeting = /^(hi|hello|hey|yo|sup)$/.test(words[0] || '');
    const startsWithNeedHelp = /^(i need help|i need some help|need help|help me|can you help|can someone help|can anyone help)$/.test(normalized);
    const startsWithQuestion = /^(i have a question|i have question|got a question|can i ask a question)$/.test(normalized);

    if (startsWithNeedHelp || startsWithQuestion) {
        return true;
    }

    if (hasGreeting && words.length <= 6) {
        const withoutGreeting = words.slice(1).join(' ');
        if (
            !withoutGreeting ||
            /^(there|team|support)$/.test(withoutGreeting) ||
            /^(i need help|need help|help|i have a question|have a question|question)$/.test(withoutGreeting)
        ) {
            return true;
        }
    }

    if (words.length <= 4 && /(help|question|support)/.test(normalized)) {
        return true;
    }

    return false;
}

function hasOpenAiConfig() {
    return Boolean(OPENAI_API_KEY && OPENAI_MODEL);
}

function isImageAttachment(attachment) {
    if (!attachment) {
        return false;
    }

    const contentType = typeof attachment.contentType === 'string' ? attachment.contentType.toLowerCase() : '';
    if (contentType.startsWith('image/')) {
        return true;
    }

    const name = typeof attachment.name === 'string' ? attachment.name.toLowerCase() : '';
    return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function getAttachmentSummary(message) {
    if (!message || !message.attachments || typeof message.attachments.values !== 'function') {
        return '';
    }

    const summaryParts = [];
    for (const attachment of message.attachments.values()) {
        if (isImageAttachment(attachment)) {
            summaryParts.push(`image:${attachment.name || 'attachment'}`);
            continue;
        }

        summaryParts.push(`attachment:${attachment.name || 'file'}`);
    }

    return summaryParts.length ? ` [${summaryParts.join(', ')}]` : '';
}

function getMessageRoleLabel(message, requesterUserId, ownerRoleId) {
    if (!message || !message.author) {
        return 'unknown';
    }

    if (requesterUserId && message.author.id === requesterUserId) {
        return 'requester';
    }

    if (
        ownerRoleId &&
        message.member &&
        message.member.roles &&
        message.member.roles.cache &&
        message.member.roles.cache.has(ownerRoleId)
    ) {
        return 'owner';
    }

    return 'participant';
}

function buildTranscript(historyMessages, requesterUserId, ownerRoleId) {
    return historyMessages
        .slice(-MAX_HISTORY_MESSAGES)
        .map((message) => {
            const timestamp = Number.isFinite(message.createdTimestamp)
                ? new Date(message.createdTimestamp).toISOString()
                : 'unknown-time';
            const authorLabel = message.author && message.author.username
                ? `${message.author.username} (${message.author.id})`
                : 'unknown-user';
            const roleLabel = getMessageRoleLabel(message, requesterUserId, ownerRoleId);
            const body = typeof message.cleanContent === 'string' && message.cleanContent.trim()
                ? message.cleanContent.trim()
                : '[no text]';

            return `[${timestamp}] ${roleLabel} ${authorLabel}: ${body}${getAttachmentSummary(message)}`;
        })
        .join('\n');
}

function getRecentImageUrls(historyMessages, requesterUserId) {
    const urls = [];
    const targetAuthorId = requesterUserId || (
        historyMessages.length && historyMessages[historyMessages.length - 1].author
            ? historyMessages[historyMessages.length - 1].author.id
            : null
    );

    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
        const message = historyMessages[index];
        if (
            !message ||
            !message.attachments ||
            typeof message.attachments.values !== 'function' ||
            (targetAuthorId && (!message.author || message.author.id !== targetAuthorId))
        ) {
            continue;
        }

        for (const attachment of message.attachments.values()) {
            if (!isImageAttachment(attachment) || !attachment.url) {
                continue;
            }

            urls.push(String(attachment.url));
            if (urls.length >= MAX_IMAGE_INPUTS) {
                return urls.reverse();
            }
        }
    }

    return urls.reverse();
}

function extractResponseText(payload) {
    if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    if (!payload || !Array.isArray(payload.output)) {
        return '';
    }

    const parts = [];
    for (const item of payload.output) {
        if (!item || item.type !== 'message' || !Array.isArray(item.content)) {
            continue;
        }

        for (const contentPart of item.content) {
            if (contentPart && contentPart.type === 'output_text' && typeof contentPart.text === 'string') {
                parts.push(contentPart.text);
            }
        }
    }

    return parts.join('\n').trim();
}

async function decideTicketResponse(options) {
    const historyMessages = Array.isArray(options && options.historyMessages) ? options.historyMessages : [];
    const triggerMessage = options && options.triggerMessage ? options.triggerMessage : null;
    const requesterUserId = options && options.requesterUserId ? String(options.requesterUserId) : null;
    const ownerRoleId = options && options.ownerRoleId ? String(options.ownerRoleId) : null;
    const channelName = options && options.channelName ? String(options.channelName) : 'unknown-channel';
    const hasPriorAssistantReply = Boolean(options && options.hasPriorAssistantReply);
    const triggerText = triggerMessage && typeof triggerMessage.cleanContent === 'string'
        ? triggerMessage.cleanContent
        : '';

    if (!hasPriorAssistantReply && isVagueOpeningMessage(triggerText)) {
        return {
            action: 'reply',
            reply: 'What do you need help with?',
            handoffReason: ''
        };
    }

    if (!hasOpenAiConfig()) {
        throw new Error('OPENAI_API_KEY must be set for the AI ticket assistant');
    }

    const transcript = buildTranscript(historyMessages, requesterUserId, ownerRoleId);
    const triggerSummary = triggerMessage
        ? `Latest triggering message author: ${triggerMessage.author ? triggerMessage.author.username : 'unknown'} (${triggerMessage.author ? triggerMessage.author.id : 'unknown'})`
        : 'Latest triggering message author: unknown';
    const content = [
        {
            type: 'input_text',
            text: [
                `Discord ticket channel: ${channelName}`,
                `Known requester user ID: ${requesterUserId || 'unknown'}`,
                `Owner role ID: ${ownerRoleId || 'unknown'}`,
                triggerSummary,
                'Decide whether to reply, handoff, or ignore.',
                'Conversation transcript:',
                transcript || '[no transcript available]'
            ].join('\n\n')
        }
    ];

    for (const imageUrl of getRecentImageUrls(historyMessages, requesterUserId)) {
        content.push({
            type: 'input_image',
            image_url: imageUrl,
            detail: 'auto'
        });
    }

    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            reasoning: {
                effort: 'none'
            },
            max_output_tokens: 220,
            instructions: ASSISTANT_INSTRUCTIONS,
            input: [
                {
                    role: 'user',
                    content
                }
            ],
            text: {
                format: {
                    type: 'json_schema',
                    name: 'ticket_assistant_action',
                    strict: true,
                    schema: RESPONSE_SCHEMA
                }
            }
        }),
        signal: AbortSignal.timeout(30000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errorMessage = payload && payload.error && payload.error.message
            ? payload.error.message
            : `OpenAI request failed (${response.status})`;
        throw new Error(errorMessage);
    }

    const rawText = extractResponseText(payload);
    if (!rawText) {
        throw new Error('OpenAI returned no structured ticket assistant output');
    }

    const parsed = JSON.parse(rawText);
    return {
        action: typeof parsed.action === 'string' ? parsed.action : 'handoff',
        reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
        handoffReason: typeof parsed.handoffReason === 'string' ? parsed.handoffReason.trim() : ''
    };
}

module.exports = {
    decideTicketResponse,
    hasOpenAiConfig
};
