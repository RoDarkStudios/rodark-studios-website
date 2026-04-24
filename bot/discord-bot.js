const { Client, GatewayIntentBits } = require('discord.js');
const { getDiscordBotControl, setDiscordBotRuntimeStatus } = require('../api/_lib/discord-bot-control-store');
const { getPostgresPool } = require('../api/_lib/postgres');
const { runStartupSync } = require('./discord-startup-sync');

const POLL_INTERVAL_MS = Number.parseInt(process.env.DISCORD_BOT_POLL_INTERVAL_MS || '5000', 10);
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();

let client = null;
let connecting = false;

function createClient() {
    const nextClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages
        ]
    });

    nextClient.once('ready', async () => {
        const tag = nextClient.user && nextClient.user.tag ? nextClient.user.tag : 'Discord bot';
        console.log(`${tag} is online.`);
        await setDiscordBotRuntimeStatus('online', null);

        try {
            const control = await getDiscordBotControl();
            await runStartupSync(nextClient, control);
            await setDiscordBotRuntimeStatus('online', null);
        } catch (error) {
            console.error('Discord startup sync failed:', error);
            await setDiscordBotRuntimeStatus('online', `Startup sync failed: ${String(error.message || 'unknown error')}`);
        }
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
