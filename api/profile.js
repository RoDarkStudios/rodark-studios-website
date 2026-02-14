const { methodNotAllowed, readJsonBody, sendJson } = require('./_lib/http');
const { requireUserFromSession } = require('./_lib/session');
const { updateUserDisplayName } = require('./_lib/passkey-store');

function normalizeDisplayName(value) {
    const displayName = String(value || '').trim();
    if (!displayName) {
        return null;
    }
    if (displayName.length > 50) {
        return null;
    }
    return displayName;
}

module.exports = async (req, res) => {
    if (!['GET', 'PATCH'].includes(req.method)) {
        return methodNotAllowed(req, res, ['GET', 'PATCH']);
    }

    try {
        const { user } = await requireUserFromSession(req, res);
        if (!user) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }

        if (req.method === 'GET') {
            return sendJson(res, 200, {
                profile: {
                    id: user.id,
                    display_name: user.display_name,
                    created_at: user.created_at,
                    updated_at: user.updated_at
                }
            });
        }

        const body = await readJsonBody(req);
        const displayName = normalizeDisplayName(body.displayName);
        if (!displayName) {
            return sendJson(res, 400, { error: 'displayName must be 1-50 characters' });
        }

        const updated = await updateUserDisplayName(user.id, displayName);
        return sendJson(res, 200, {
            profile: {
                id: updated.id,
                display_name: updated.display_name,
                created_at: updated.created_at,
                updated_at: updated.updated_at
            }
        });
    } catch (error) {
        return sendJson(res, 500, { error: 'Profile request failed', details: error.message });
    }
};
