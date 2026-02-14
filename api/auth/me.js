const { methodNotAllowed, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return methodNotAllowed(req, res, ['GET']);
    }

    try {
        const { user } = await requireUserFromSession(req, res);
        if (!user) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }

        return sendJson(res, 200, {
            user: {
                id: user.id,
                created_at: user.created_at,
                user_metadata: {
                    username: user.username,
                    display_name: user.display_name,
                    provider: user.provider
                },
                profile_url: user.profile_url
            }
        });
    } catch (error) {
        return sendJson(res, 500, { error: 'Failed to fetch user', details: error.message });
    }
};
