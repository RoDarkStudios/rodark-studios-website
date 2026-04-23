const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireAdmin } = require('../_lib/admin-auth');
const {
    getDiscordBotControl,
    updateDiscordBotControl
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
        const assistantConfig = body && typeof body.aiTicketAssistant === 'object' && body.aiTicketAssistant
            ? body.aiTicketAssistant
            : null;
        const patch = {};

        if (body && Object.prototype.hasOwnProperty.call(body, 'desiredEnabled')) {
            patch.desiredEnabled = Boolean(body.desiredEnabled);
        }

        if (assistantConfig && Object.prototype.hasOwnProperty.call(assistantConfig, 'enabled')) {
            patch.aiTicketAssistantEnabled = Boolean(assistantConfig.enabled);
        }

        if (assistantConfig && Object.prototype.hasOwnProperty.call(assistantConfig, 'ticketCategoryId')) {
            patch.aiTicketCategoryId = assistantConfig.ticketCategoryId;
        }

        if (assistantConfig && Object.prototype.hasOwnProperty.call(assistantConfig, 'ownerRoleId')) {
            patch.aiTicketOwnerRoleId = assistantConfig.ownerRoleId;
        }

        const control = await updateDiscordBotControl(patch, auth.user);
        return sendJson(res, 200, { control });
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
