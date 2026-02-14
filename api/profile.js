const { methodNotAllowed, readJsonBody, sendJson } = require('./_lib/http');
const { requireUserFromSession } = require('./_lib/session');
const { findUserByUsername, updateUserUsername } = require('./_lib/passkey-store');

function normalizeUsername(value) {
    const username = String(value || '').trim().toLowerCase();
    if (!username) {
        return null;
    }

    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        return null;
    }

    return username;
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
                    username: user.username,
                    created_at: user.created_at,
                    updated_at: user.updated_at
                }
            });
        }

        const body = await readJsonBody(req);
        const username = normalizeUsername(body.username);
        if (!username) {
            return sendJson(res, 400, { error: 'username must be 3-30 chars: lowercase letters, numbers, or _' });
        }

        if (username !== user.username) {
            const existingUsername = await findUserByUsername(username);
            if (existingUsername && existingUsername.id !== user.id) {
                return sendJson(res, 409, { error: 'This username is already taken' });
            }
        }

        const updated = await updateUserUsername(user.id, username);
        return sendJson(res, 200, {
            profile: {
                id: updated.id,
                username: updated.username,
                created_at: updated.created_at,
                updated_at: updated.updated_at
            }
        });
    } catch (error) {
        return sendJson(res, 500, { error: 'Profile request failed', details: error.message });
    }
};
