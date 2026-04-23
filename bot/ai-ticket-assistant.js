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
    'RoDark Studios makes Roblox games, so respond like a strong Roblox game support assistant rather than a generic helpdesk bot.',
    'Your job is to help briefly, think carefully, and gather only the most useful missing detail before a human needs to step in.',
    'Be concise, calm, and natural. One short message is preferred.',
    'First decide whether the user has actually explained the problem. If not, ask one simple clarifying question and let them explain before you start troubleshooting.',
    'After the problem is clear, ask at most one follow-up question, and only if that question is genuinely useful for isolating the issue.',
    'Do not bombard the user with questions. Do not ask for multiple things at once unless there is a very strong reason.',
    'Prefer the most informative next question, not the most generic one.',
    'Use good judgment for Roblox support: ask about the exact in-game action, what they expected, what happened instead, whether it happens consistently, and what they already tried, but only when those details are actually the next useful thing to ask.',
    'Avoid low-value or premature questions. Do not ask for exact timestamps, server details, receipts, usernames, or similar operational details unless the conversation clearly makes them necessary.',
    'If repo context is provided, treat it as the main evidence for game-specific answers and use it carefully.',
    'Never answer questions about server-side systems, exploits, hidden admin/debug behavior, security-sensitive logic, or anything that could give a competitive advantage or advance the game too quickly.',
    'If repo context is missing, weak, or does not clearly support the answer, and the question needs internal game knowledge, choose handoff.',
    'If there is no clearly useful next question, or the issue needs account investigation, moderation decisions, development context, or staff action, choose handoff.',
    'Do not guess. Do not invent fixes. Do not overexplain. Do not speak like a policy document.',
    'If the latest message does not appear to be from the person needing help, choose ignore.',
    'If the user attached images, use them when relevant.',
    'Return JSON only that matches the provided schema.'
].join(' ');

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
    if (!hasOpenAiConfig()) {
        throw new Error('OPENAI_API_KEY must be set for the AI ticket assistant');
    }

    const historyMessages = Array.isArray(options && options.historyMessages) ? options.historyMessages : [];
    const triggerMessage = options && options.triggerMessage ? options.triggerMessage : null;
    const requesterUserId = options && options.requesterUserId ? String(options.requesterUserId) : null;
    const ownerRoleId = options && options.ownerRoleId ? String(options.ownerRoleId) : null;
    const channelName = options && options.channelName ? String(options.channelName) : 'unknown-channel';
    const repoContext = options && options.repoContext && typeof options.repoContext === 'object'
        ? options.repoContext
        : null;

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
                repoContext
                    ? `Repo context is available from ${repoContext.owner}/${repoContext.repo} on branch ${repoContext.branch} at commit ${repoContext.headCommitSha}.`
                    : 'Repo context is not available for this question.',
                'Conversation transcript:',
                transcript || '[no transcript available]',
                repoContext && Array.isArray(repoContext.snippets) && repoContext.snippets.length
                    ? `Relevant repo snippets:\n${repoContext.snippets.join('\n\n---\n\n')}`
                    : 'Relevant repo snippets: [none]'
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
                effort: 'high'
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
                verbosity: 'low',
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
