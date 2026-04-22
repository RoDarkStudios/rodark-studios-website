const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const {
    getDiscordBotControl,
    setDiscordBotDesiredEnabled
} = require('../_lib/discord-bot-control-store');

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
            return sendJson(res, 200, { control });
        }

        const body = await readJsonBody(req);
        const desiredEnabled = Boolean(body && body.desiredEnabled);
        const control = await setDiscordBotDesiredEnabled(desiredEnabled, auth.user);
        return sendJson(res, 200, { control });
    } catch (error) {
        return sendJson(res, 500, {
            error: 'Failed to update Discord bot control',
            details: error.message
        });
    }
};
