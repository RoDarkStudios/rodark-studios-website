const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const {
    getDiscordBotControl,
    updateDiscordBotControl
} = require('../_lib/discord-bot-control-store');

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const CHANNEL_LOOKUP_CACHE_TTL_MS = 60 * 1000;
const channelLookupCache = new Map();
const channelLookupInflight = new Map();

async function discordApiGet(pathname) {
    if (!DISCORD_BOT_TOKEN) {
        throw new Error('DISCORD_BOT_TOKEN is not configured for Discord channel lookup');
    }

    const response = await fetch(`${DISCORD_API_BASE_URL}${pathname}`, {
        method: 'GET',
        headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`
        },
        signal: AbortSignal.timeout(15000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload && payload.message ? payload.message : `Discord API failed (${response.status})`);
    }

    return payload;
}

function getGuildDiscoveryChannelIds(control) {
    const startup = control && control.startupContentSync && typeof control.startupContentSync === 'object'
        ? control.startupContentSync
        : {};

    return [
        startup.rulesChannelId,
        startup.infoChannelId,
        startup.rolesChannelId,
        startup.staffInfoChannelId,
        startup.gameTestInfoChannelId
    ]
        .filter(Boolean)
        .map((value) => String(value));
}

async function resolveDiscordGuildId(control) {
    if (control && control.guildId) {
        return String(control.guildId);
    }

    const configuredGuildId = String(process.env.DISCORD_BOT_GUILD_ID || '').trim();
    if (configuredGuildId) {
        return configuredGuildId;
    }

    for (const channelId of getGuildDiscoveryChannelIds(control)) {
        try {
            const channel = await discordApiGet(`/channels/${encodeURIComponent(channelId)}`);
            if (channel && channel.guild_id) {
                return String(channel.guild_id);
            }
        } catch (error) {
            continue;
        }
    }

    return '';
}

function buildDiscordChannelLookup(channels) {
    const categoryById = new Map(
        channels
            .filter((channel) => channel && Number(channel.type) === 4)
            .map((channel) => [String(channel.id), String(channel.name || '')])
    );

    const mapped = channels
        .filter((channel) => channel && channel.id && channel.name)
        .map((channel) => ({
            id: String(channel.id),
            name: String(channel.name),
            type: Number(channel.type),
            parentId: channel.parent_id ? String(channel.parent_id) : '',
            parentName: channel.parent_id && categoryById.has(String(channel.parent_id))
                ? categoryById.get(String(channel.parent_id))
                : ''
        }));

    mapped.sort((left, right) => {
        const leftCategory = left.parentName || '';
        const rightCategory = right.parentName || '';
        if (leftCategory !== rightCategory) {
            return leftCategory.localeCompare(rightCategory);
        }

        if (left.type !== right.type) {
            return left.type - right.type;
        }

        return left.name.localeCompare(right.name);
    });

    return mapped;
}

async function getDiscordChannelLookup(control) {
    try {
        const guildId = await resolveDiscordGuildId(control);
        if (!guildId) {
            return {
                guildId: '',
                channels: []
            };
        }

        const cached = channelLookupCache.get(guildId);
        if (cached && (Date.now() - cached.fetchedAt) < CHANNEL_LOOKUP_CACHE_TTL_MS) {
            return {
                guildId,
                channels: cached.channels
            };
        }

        if (channelLookupInflight.has(guildId)) {
            return await channelLookupInflight.get(guildId);
        }

        const pendingLookup = (async () => {
            try {
                const channels = await discordApiGet(`/guilds/${encodeURIComponent(guildId)}/channels`);
                const mappedChannels = buildDiscordChannelLookup(Array.isArray(channels) ? channels : []);
                channelLookupCache.set(guildId, {
                    fetchedAt: Date.now(),
                    channels: mappedChannels
                });
                return {
                    guildId,
                    channels: mappedChannels
                };
            } catch (error) {
                if (cached && Array.isArray(cached.channels) && cached.channels.length) {
                    return {
                        guildId,
                        channels: cached.channels
                    };
                }

                return {
                    guildId: '',
                    channels: [],
                    error: String(error.message || error)
                };
            } finally {
                channelLookupInflight.delete(guildId);
            }
        })();

        channelLookupInflight.set(guildId, pendingLookup);
        return await pendingLookup;
    } catch (error) {
        return {
            guildId: '',
            channels: [],
            error: String(error.message || error)
        };
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return methodNotAllowed(req, res, ['GET', 'POST']);
    }

    try {
        const auth = await requireAdmin(req, res);
        if (!auth.user) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }
        if (!auth.isAdmin) {
            return sendJson(res, 403, { error: 'Admin access required' });
        }

        if (req.method === 'GET') {
            const control = await getDiscordBotControl();
            const channelLookup = await getDiscordChannelLookup(control);
            return sendJson(res, 200, {
                control,
                channelLookup
            });
        }

        const body = await readJsonBody(req);
        const startupContentSync = body && typeof body.startupContentSync === 'object' && body.startupContentSync
            ? body.startupContentSync
            : null;
        const patch = {};

        if (body && Object.prototype.hasOwnProperty.call(body, 'desiredEnabled')) {
            patch.desiredEnabled = Boolean(body.desiredEnabled);
        }

        if (body && Object.prototype.hasOwnProperty.call(body, 'guildId')) {
            patch.guildId = body.guildId;
        }

        if (startupContentSync && Object.prototype.hasOwnProperty.call(startupContentSync, 'rulesChannelId')) {
            patch.contentRulesChannelId = startupContentSync.rulesChannelId;
        }

        if (startupContentSync && Object.prototype.hasOwnProperty.call(startupContentSync, 'infoChannelId')) {
            patch.contentInfoChannelId = startupContentSync.infoChannelId;
        }

        if (startupContentSync && Object.prototype.hasOwnProperty.call(startupContentSync, 'rolesChannelId')) {
            patch.contentRolesChannelId = startupContentSync.rolesChannelId;
        }

        if (startupContentSync && Object.prototype.hasOwnProperty.call(startupContentSync, 'staffInfoChannelId')) {
            patch.contentStaffInfoChannelId = startupContentSync.staffInfoChannelId;
        }

        if (startupContentSync && Object.prototype.hasOwnProperty.call(startupContentSync, 'gameTestInfoChannelId')) {
            patch.contentGameTestInfoChannelId = startupContentSync.gameTestInfoChannelId;
        }

        const control = await updateDiscordBotControl(patch, auth.user);
        const channelLookup = await getDiscordChannelLookup(control);
        return sendJson(res, 200, { control, channelLookup });
    } catch (error) {
        const statusCode = /required|valid discord id|must be a valid discord id/i.test(String(error && error.message || ''))
            ? 400
            : 500;
        return sendJson(res, statusCode, {
            error: 'Failed to update Discord bot control',
            details: error.message
        });
    }
};
