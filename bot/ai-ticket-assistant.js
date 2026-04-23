const {
    getGameRepoSummary,
    hasGameRepoConfig,
    listRepoPaths,
    readRepoFile,
    readRepoFileChunk,
    searchRepo
} = require('./game-repo-context');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const MAX_HISTORY_MESSAGES = 15;
const MAX_IMAGE_INPUTS = 3;
const MAX_AGENT_STEPS = 8;
const OPENAI_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TICKET_AGENT_TIMEOUT_MS || '90000', 10);

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
    'Safe repo scope is limited to client/shared, player-facing code and public constants/config exposed there.',
    'Normal player-help questions about visible gameplay systems, progression, UI, items, mechanics, and other player-facing behavior are allowed if the safe repo evidence supports the answer.',
    'Do not handoff just because a question is about the game. If the topic appears player-facing and safe, investigate the repo tools first and answer when the evidence is good enough.',
    'If the topic appears player-facing and safe but the evidence is still thin, ask one short clarifying question before handing off.',
    'Never answer questions about server-side systems, exploits, admin or debug behavior, security-sensitive logic, anti-cheat, hidden formulas, private rates, hidden spawn logic, or other non-public internals that would create an unfair advantage.',
    'If repo context is missing, weak, or does not clearly support the answer, and the question needs internal game knowledge, choose handoff.',
    'If there is no clearly useful next question, or the issue needs account investigation, moderation decisions, development context, or staff action, choose handoff.',
    'Do not guess. Do not invent fixes. Do not overexplain. Do not speak like a policy document.',
    'If the latest message does not appear to be from the person needing help, choose ignore.',
    'If the user attached images, use them when relevant.',
    'If repo tools are available, use them for game-specific questions. Search, inspect files, refine your search, and read chunks as needed before deciding.',
    'Do not rely on repo memory. For game-specific questions, investigate with tools first unless the user has not explained the issue yet.',
    'Final output must be a raw JSON object with keys action, reply, and handoffReason.'
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

function getLatestRequesterMessage(historyMessages, requesterUserId) {
    if (!Array.isArray(historyMessages) || !historyMessages.length) {
        return null;
    }

    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
        const message = historyMessages[index];
        if (!message || !message.author) {
            continue;
        }

        if (requesterUserId && message.author.id !== requesterUserId) {
            continue;
        }

        return message;
    }

    return historyMessages[historyMessages.length - 1] || null;
}

function getLatestRequesterText(historyMessages, requesterUserId) {
    const latestRequesterMessage = getLatestRequesterMessage(historyMessages, requesterUserId);
    if (!latestRequesterMessage || typeof latestRequesterMessage.cleanContent !== 'string') {
        return '';
    }

    return latestRequesterMessage.cleanContent.trim();
}

function tokenizeRequesterText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2);
}

function shouldRequireRepoInvestigation(text, toolsAvailable) {
    if (!toolsAvailable) {
        return false;
    }

    const normalizedText = String(text || '').trim().toLowerCase();
    if (!normalizedText) {
        return false;
    }

    const tokens = tokenizeRequesterText(normalizedText);
    if (!tokens.length) {
        return false;
    }

    if (tokens.length >= 3) {
        return true;
    }

    if (normalizedText.length >= 14) {
        return true;
    }

    return /^(can|how|what|when|where|why|is|are|does|do|did|will|would|should)\b/.test(normalizedText);
}

function isPublicHelpQuestion(text) {
    const normalizedText = String(text || '').trim().toLowerCase();
    if (!normalizedText) {
        return false;
    }

    if (/\b(how to|how do i|how can i|where do i|where can i|get|unlock|upgrade|use|find|available|obtain|access|open|start)\b/.test(normalizedText)) {
        return true;
    }

    return /^(how|what|where|can)\b/.test(normalizedText);
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

function getFunctionCalls(payload) {
    if (!payload || !Array.isArray(payload.output)) {
        return [];
    }

    return payload.output.filter((item) => item && item.type === 'function_call');
}

function buildRepoTools() {
    if (!hasGameRepoConfig()) {
        return [];
    }

    const repoSummary = getGameRepoSummary();
    const safeScopeText = repoSummary.safePathPrefixes.join(', ');

    return [
        {
            type: 'function',
            name: 'search_repo',
            description: `Search the safe client/shared side of ${repoSummary.owner}/${repoSummary.repo} on branch ${repoSummary.branch}. Safe scope: ${safeScopeText}. Use this first for most game-specific questions.`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query describing gameplay systems, UI, item names, mechanics, or related concepts.'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 8
                    }
                },
                required: ['query']
            }
        },
        {
            type: 'function',
            name: 'list_paths',
            description: `List safe file paths within ${repoSummary.owner}/${repoSummary.repo} on branch ${repoSummary.branch}. Use this to inspect likely directories or discover relevant modules.`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    prefix: {
                        type: 'string',
                        description: 'Optional repo path prefix such as src/ReplicatedStorage/ or src/StarterPlayerScripts/.'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 60
                    }
                },
                required: []
            }
        },
        {
            type: 'function',
            name: 'read_file',
            description: `Read a safe repo file from ${repoSummary.owner}/${repoSummary.repo} on branch ${repoSummary.branch}. Use after search_repo or list_paths identifies a promising file.`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    path: {
                        type: 'string',
                        description: 'Exact repo path to read.'
                    }
                },
                required: ['path']
            }
        },
        {
            type: 'function',
            name: 'read_file_chunk',
            description: `Read specific line ranges from a safe repo file in ${repoSummary.owner}/${repoSummary.repo} on branch ${repoSummary.branch}. Use this after read_file when you need deeper evidence from a subsection.`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    path: {
                        type: 'string',
                        description: 'Exact repo path to read.'
                    },
                    start_line: {
                        type: 'integer',
                        minimum: 1
                    },
                    end_line: {
                        type: 'integer',
                        minimum: 1
                    }
                },
                required: ['path', 'start_line', 'end_line']
            }
        }
    ];
}

async function executeRepoToolCall(toolCall) {
    const toolName = toolCall && toolCall.name ? String(toolCall.name) : '';
    const rawArguments = toolCall && typeof toolCall.arguments === 'string' ? toolCall.arguments : '{}';
    const args = JSON.parse(rawArguments);

    if (toolName === 'search_repo') {
        return searchRepo(args.query, args.limit);
    }

    if (toolName === 'list_paths') {
        return listRepoPaths(args.prefix, args.limit);
    }

    if (toolName === 'read_file') {
        return readRepoFile(args.path);
    }

    if (toolName === 'read_file_chunk') {
        return readRepoFileChunk(args.path, args.start_line, args.end_line);
    }

    throw new Error(`Unsupported repo tool: ${toolName}`);
}

function parseDecisionText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
        return null;
    }

    const candidates = [text];
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
        candidates.push(fencedMatch[1].trim());
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        candidates.push(objectMatch[0]);
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            return {
                action: typeof parsed.action === 'string' ? parsed.action : 'handoff',
                reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
                handoffReason: typeof parsed.handoffReason === 'string' ? parsed.handoffReason.trim() : ''
            };
        } catch (error) {
            continue;
        }
    }

    return null;
}

async function requestOpenAiResponse(body) {
    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
            Number.isFinite(OPENAI_REQUEST_TIMEOUT_MS) && OPENAI_REQUEST_TIMEOUT_MS >= 15000
                ? OPENAI_REQUEST_TIMEOUT_MS
                : 90000
        )
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errorMessage = payload && payload.error && payload.error.message
            ? payload.error.message
            : `OpenAI request failed (${response.status})`;
        throw new Error(errorMessage);
    }

    return payload;
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
    const tools = buildRepoTools();
    const repoSummary = hasGameRepoConfig() ? getGameRepoSummary() : null;
    const latestRequesterText = getLatestRequesterText(historyMessages, requesterUserId);
    const requireRepoInvestigation = shouldRequireRepoInvestigation(latestRequesterText, tools.length > 0);
    const publicHelpQuestion = isPublicHelpQuestion(latestRequesterText);

    const transcript = buildTranscript(historyMessages, requesterUserId, ownerRoleId);
    const triggerSummary = triggerMessage
        ? `Latest triggering message author: ${triggerMessage.author ? triggerMessage.author.username : 'unknown'} (${triggerMessage.author ? triggerMessage.author.id : 'unknown'})`
        : 'Latest triggering message author: unknown';
    const initialContent = [
        {
            type: 'input_text',
            text: [
                `Discord ticket channel: ${channelName}`,
                `Known requester user ID: ${requesterUserId || 'unknown'}`,
                `Owner role ID: ${ownerRoleId || 'unknown'}`,
                triggerSummary,
                'Decide whether to reply, handoff, or ignore. Investigate first when the question is game-specific and repo tools are available.',
                repoSummary
                    ? `Repo tools are available for ${repoSummary.owner}/${repoSummary.repo} on branch ${repoSummary.branch}. Safe scope is limited to: ${repoSummary.safePathPrefixes.join(', ')}.`
                    : 'Repo tools are not available for this question.',
                publicHelpQuestion
                    ? 'This appears to be a normal public gameplay/help question. Prefer a repo-backed answer, or ask one short clarifying question instead of handing off if evidence is still thin.'
                    : 'If the question is unsafe or about non-public internals, handoff is allowed.',
                requireRepoInvestigation
                    ? 'This looks like a substantive gameplay/support question. Use repo tools before answering or handing off.'
                    : 'If the user is still vague, ask one simple clarifying question before investigating.',
                'Conversation transcript:',
                transcript || '[no transcript available]'
            ].join('\n\n')
        }
    ];

    for (const imageUrl of getRecentImageUrls(historyMessages, requesterUserId)) {
        initialContent.push({
            type: 'input_image',
            image_url: imageUrl,
            detail: 'auto'
        });
    }

    let previousResponseId = null;
    let nextInput = [
        {
            role: 'user',
            content: initialContent
        }
    ];

    for (let stepIndex = 0; stepIndex < MAX_AGENT_STEPS; stepIndex += 1) {
        const payload = await requestOpenAiResponse({
            model: OPENAI_MODEL,
            reasoning: {
                effort: 'high'
            },
            max_output_tokens: 900,
            instructions: ASSISTANT_INSTRUCTIONS,
            input: nextInput,
            previous_response_id: previousResponseId || undefined,
            tools: tools.length ? tools : undefined,
            tool_choice: requireRepoInvestigation && stepIndex === 0 && tools.length ? 'required' : 'auto',
            text: {
                verbosity: 'low'
            }
        });

        const functionCalls = getFunctionCalls(payload);
        if (functionCalls.length) {
            const toolOutputs = [];

            for (const functionCall of functionCalls) {
                const result = await executeRepoToolCall(functionCall);
                toolOutputs.push({
                    type: 'function_call_output',
                    call_id: functionCall.call_id,
                    output: JSON.stringify(result)
                });
            }

            previousResponseId = payload.id;
            nextInput = toolOutputs;
            continue;
        }

        const rawText = extractResponseText(payload);
        const parsed = parseDecisionText(rawText);
        if (!parsed) {
            throw new Error('OpenAI returned no valid ticket assistant decision JSON');
        }

        if (publicHelpQuestion && parsed.action === 'handoff') {
            return {
                action: 'reply',
                reply: 'Can you tell me a bit more about what you are trying to do in-game?',
                handoffReason: ''
            };
        }

        return parsed;
    }

    return {
        action: 'handoff',
        reply: '',
        handoffReason: 'repo_agent_step_limit'
    };
}

module.exports = {
    decideTicketResponse,
    hasOpenAiConfig
};
