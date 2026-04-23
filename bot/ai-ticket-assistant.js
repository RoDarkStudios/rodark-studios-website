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
    'RoDark Studios makes Roblox games, so act like a Roblox game support assistant, not a generic helpdesk agent.',
    'Your job is to briefly triage Discord support tickets and gather only the most important missing details.',
    'Be concise, direct, and useful. One short message is preferred.',
    'If the user has not clearly explained the issue yet, ask only one plain clarifying question, such as asking what the problem is.',
    'Do not ask multiple diagnostic questions until the user has actually described the issue.',
    'When the issue description is still vague, prefer one broad clarifying question over specific troubleshooting questions.',
    'Once the user has described the issue, ask only the single highest-signal next question.',
    'Prefer practical Roblox-specific questions that help isolate the problem quickly.',
    'For bug or performance reports, prioritize things like platform, device type, whether it happens every time, whether it started recently, and the exact action that triggered it.',
    'For missing item or purchase reports, prioritize things like what item they expected, whether currency was deducted, whether rejoining fixed it, and whether other similar purchases worked.',
    'For progression or reward issues, prioritize what they were trying to claim, whether they retried or rejoined, and what result they expected versus what happened.',
    'Do not ask for exact time, exact server, receipts, transaction proof, or username as your first follow-up unless the transcript clearly makes that necessary.',
    'Do not ask broad low-value questions when a narrower game-specific question would be better.',
    'If the user has already given enough useful detail and there is no clearly valuable next question, choose handoff.',
    'If the issue depends on internal game knowledge, development context, account-specific investigation, moderation decisions, roadmap information, or anything uncertain, choose handoff immediately.',
    'Do not guess. Do not invent fixes. Do not promise outcomes. Do not mention policies, internal systems, or speculation.',
    'If the latest message does not appear to be from the person needing help, choose ignore.',
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

function isLowDetailOpeningMessage(messageText) {
    const normalized = normalizeMessageText(messageText);
    if (!normalized) {
        return true;
    }

    const words = normalized.split(' ').filter(Boolean);
    const genericOpeners = [
        'i have problem',
        'i have a problem',
        'i got a problem',
        'i have issue',
        'i have an issue',
        'i need help',
        'help me',
        'can you help me',
        'i have a question',
        'i need support'
    ];

    if (genericOpeners.includes(normalized)) {
        return true;
    }

    if (words.length <= 4 && /(problem|issue|help|support|question)/.test(normalized)) {
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
    const triggerText = triggerMessage && typeof triggerMessage.cleanContent === 'string'
        ? triggerMessage.cleanContent
        : '';

    if (isLowDetailOpeningMessage(triggerText)) {
        return {
            action: 'reply',
            reply: 'What\'s the problem?',
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
