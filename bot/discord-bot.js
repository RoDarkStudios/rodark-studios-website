const { ChannelType, Client, GatewayIntentBits } = require('discord.js');
const {
    THREAD_STATUS_HANDED_OFF,
    ensureDiscordBotTicketThread,
    getDiscordBotControl,
    getDiscordBotTicketThread,
    markDiscordBotTicketThreadAiResponded,
    markDiscordBotTicketThreadGreeted,
    markDiscordBotTicketThreadHandedOff,
    setDiscordBotRuntimeStatus,
    setDiscordBotTicketThreadRequester
} = require('../api/_lib/discord-bot-control-store');
const { getPostgresPool } = require('../api/_lib/postgres');
const { decideTicketResponse } = require('./ai-ticket-assistant');

const POLL_INTERVAL_MS = Number.parseInt(process.env.DISCORD_BOT_POLL_INTERVAL_MS || '5000', 10);
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const TICKET_GREETING = "You've contacted support. How can I help?";
const HISTORY_FETCH_LIMIT = 15;

let client = null;
let connecting = false;
const channelQueues = new Map();

function getThreadIdentity(channel) {
    return {
        channelId: channel.id,
        guildId: channel.guild && channel.guild.id ? channel.guild.id : null,
        categoryId: channel.parentId || null
    };
}

function isOwnerMessage(message, ownerRoleId) {
    return Boolean(
        ownerRoleId &&
        message &&
        message.member &&
        message.member.roles &&
        message.member.roles.cache &&
        message.member.roles.cache.has(ownerRoleId)
    );
}

function getMemberRoleIds(message) {
    if (!message || !message.member || !message.member.roles || !message.member.roles.cache) {
        return [];
    }

    return Array.from(message.member.roles.cache.keys());
}

function isAiAssistantConfigured(control) {
    return Boolean(
        control &&
        control.desiredEnabled &&
        control.aiTicketAssistant &&
        control.aiTicketAssistant.enabled &&
        control.aiTicketAssistant.ticketCategoryId &&
        control.aiTicketAssistant.ownerRoleId
    );
}

function isMonitoredTicketChannel(channel, control) {
    if (!channel || channel.type !== ChannelType.GuildText) {
        return false;
    }

    if (!isAiAssistantConfigured(control)) {
        return false;
    }

    return channel.parentId === control.aiTicketAssistant.ticketCategoryId;
}

async function withChannelLock(channelId, callback) {
    if (!channelId) {
        return;
    }

    const previousQueue = channelQueues.get(channelId) || Promise.resolve();
    const nextQueue = previousQueue
        .catch(() => {})
        .then(callback);

    channelQueues.set(channelId, nextQueue);

    try {
        await nextQueue;
    } finally {
        if (channelQueues.get(channelId) === nextQueue) {
            channelQueues.delete(channelId);
        }
    }
}

async function fetchTicketHistory(channel) {
    const collection = await channel.messages.fetch({ limit: HISTORY_FETCH_LIMIT });
    return Array.from(collection.values()).sort((left, right) => left.createdTimestamp - right.createdTimestamp);
}

async function sendOwnerHandoffMessage(channel, ownerRoleId) {
    await channel.send({
        content: `This needs an owner to take over. <@&${ownerRoleId}>`,
        allowedMentions: {
            roles: [ownerRoleId]
        }
    });
}

async function handleTicketCreated(channel) {
    const control = await getDiscordBotControl();
    if (!isMonitoredTicketChannel(channel, control)) {
        return;
    }

    await withChannelLock(channel.id, async () => {
        const existingThread = await getDiscordBotTicketThread(channel.id);
        if (existingThread && existingThread.greetedAt) {
            return;
        }

        await channel.send(TICKET_GREETING);
        await markDiscordBotTicketThreadGreeted(getThreadIdentity(channel));
    });
}

async function handleTicketMessage(message) {
    if (!message || !message.inGuild() || !message.channel || message.author.bot) {
        return;
    }

    const control = await getDiscordBotControl();
    if (!isMonitoredTicketChannel(message.channel, control)) {
        return;
    }

    const ownerRoleId = control.aiTicketAssistant.ownerRoleId;
    const threadIdentity = getThreadIdentity(message.channel);

    await withChannelLock(message.channel.id, async () => {
        let thread = await ensureDiscordBotTicketThread(threadIdentity);
        if (thread && thread.status === THREAD_STATUS_HANDED_OFF) {
            return;
        }

        if (isOwnerMessage(message, ownerRoleId)) {
            console.log('[ticket-ai] handoff reason=owner_joined', {
                channelId: message.channel.id,
                userId: message.author.id,
                username: message.author.username,
                ownerRoleId,
                memberRoleIds: getMemberRoleIds(message)
            });
            await markDiscordBotTicketThreadHandedOff(threadIdentity, 'owner_joined');
            return;
        }

        if (!thread.requesterUserId) {
            thread = await setDiscordBotTicketThreadRequester(threadIdentity, {
                userId: message.author.id,
                username: message.author.username
            });
        } else if (thread.requesterUserId !== message.author.id) {
            return;
        }

        const historyMessages = await fetchTicketHistory(message.channel);

        let decision;
        try {
            decision = await decideTicketResponse({
                channelName: message.channel.name,
                historyMessages,
                triggerMessage: message,
                requesterUserId: thread.requesterUserId,
                ownerRoleId,
                hasPriorAssistantReply: Boolean(thread.lastAiResponseAt)
            });
        } catch (error) {
            console.error(`AI ticket assistant failed in #${message.channel.name}:`, error);
            console.log('[ticket-ai] handoff reason=assistant_error', {
                channelId: message.channel.id,
                userId: message.author.id,
                username: message.author.username,
                ownerRoleId,
                memberRoleIds: getMemberRoleIds(message),
                error: String(error && error.message ? error.message : error)
            });
            await sendOwnerHandoffMessage(message.channel, ownerRoleId);
            await markDiscordBotTicketThreadHandedOff(
                threadIdentity,
                `assistant_error:${String(error.message || 'unknown').slice(0, 180)}`
            );
            return;
        }

        if (!decision || decision.action === 'ignore') {
            return;
        }

        if (decision.action === 'handoff') {
            console.log('[ticket-ai] handoff reason=model_handoff', {
                channelId: message.channel.id,
                userId: message.author.id,
                username: message.author.username,
                ownerRoleId,
                memberRoleIds: getMemberRoleIds(message),
                modelReason: decision.handoffReason || 'assistant_handoff'
            });
            await sendOwnerHandoffMessage(message.channel, ownerRoleId);
            await markDiscordBotTicketThreadHandedOff(
                threadIdentity,
                decision.handoffReason || 'assistant_handoff'
            );
            return;
        }

        if (!decision.reply) {
            console.log('[ticket-ai] handoff reason=assistant_empty_reply', {
                channelId: message.channel.id,
                userId: message.author.id,
                username: message.author.username,
                ownerRoleId,
                memberRoleIds: getMemberRoleIds(message)
            });
            await sendOwnerHandoffMessage(message.channel, ownerRoleId);
            await markDiscordBotTicketThreadHandedOff(threadIdentity, 'assistant_empty_reply');
            return;
        }

        await message.channel.send({
            content: decision.reply.slice(0, 1900)
        });
        await markDiscordBotTicketThreadAiResponded(threadIdentity);
    });
}

function createClient() {
    const nextClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    nextClient.once('ready', async () => {
        const tag = nextClient.user && nextClient.user.tag ? nextClient.user.tag : 'Discord bot';
        console.log(`${tag} is online.`);
        await setDiscordBotRuntimeStatus('online', null);
    });

    nextClient.on('channelCreate', (channel) => {
        handleTicketCreated(channel).catch(async (error) => {
            console.error('Ticket creation handler failed:', error);
            await setDiscordBotRuntimeStatus('error', error.message);
        });
    });

    nextClient.on('messageCreate', (message) => {
        handleTicketMessage(message).catch(async (error) => {
            console.error('Ticket message handler failed:', error);
            await setDiscordBotRuntimeStatus('error', error.message);
        });
    });

    nextClient.on('error', async (error) => {
        console.error('Discord client error:', error);
        await setDiscordBotRuntimeStatus('error', error.message);
    });

    nextClient.on('shardDisconnect', async () => {
        await setDiscordBotRuntimeStatus('offline', null);
    });

    return nextClient;
}

async function connectBot() {
    if (client || connecting) {
        return;
    }

    if (!DISCORD_BOT_TOKEN) {
        await setDiscordBotRuntimeStatus('error', 'DISCORD_BOT_TOKEN must be set');
        return;
    }

    connecting = true;
    await setDiscordBotRuntimeStatus('connecting', null);

    try {
        client = createClient();
        await client.login(DISCORD_BOT_TOKEN);
    } catch (error) {
        console.error('Failed to connect Discord bot:', error);
        client = null;
        await setDiscordBotRuntimeStatus('error', error.message);
    } finally {
        connecting = false;
    }
}

async function disconnectBot() {
    if (!client && !connecting) {
        await setDiscordBotRuntimeStatus('offline', null);
        return;
    }

    const currentClient = client;
    client = null;

    if (currentClient) {
        currentClient.removeAllListeners();
        await currentClient.destroy();
    }

    await setDiscordBotRuntimeStatus('offline', null);
    console.log('Discord bot is offline.');
}

async function syncBotState() {
    const control = await getDiscordBotControl();
    if (control && control.desiredEnabled) {
        await connectBot();
        return;
    }

    await disconnectBot();
}

async function shutdown() {
    try {
        await disconnectBot();
    } finally {
        await getPostgresPool().end();
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
    console.log('RoDark Discord bot worker starting.');
    await syncBotState();
    setInterval(() => {
        syncBotState().catch(async (error) => {
            console.error('Discord bot state sync failed:', error);
            await setDiscordBotRuntimeStatus('error', error.message).catch(() => {});
        });
    }, Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS >= 1000 ? POLL_INTERVAL_MS : 5000);
}

main().catch(async (error) => {
    console.error(error);
    await setDiscordBotRuntimeStatus('error', error.message).catch(() => {});
    process.exitCode = 1;
});
