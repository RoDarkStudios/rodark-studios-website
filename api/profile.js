const { methodNotAllowed, readJsonBody, sendJson } = require('./_lib/http');
const { requireUserFromSession } = require('./_lib/session');
const { supabaseRestRequest } = require('./_lib/supabase');

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
        const { user, accessToken } = await requireUserFromSession(req, res);
        if (!user || !accessToken) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }
        const userIdFilter = encodeURIComponent(user.id);

        if (req.method === 'GET') {
            const { response, data } = await supabaseRestRequest(`/profiles?id=eq.${userIdFilter}&select=id,display_name,created_at,updated_at`, {
                method: 'GET',
                token: accessToken
            });

            if (!response.ok) {
                return sendJson(res, response.status, { error: 'Failed to load profile', details: data });
            }

            return sendJson(res, 200, { profile: Array.isArray(data) ? data[0] || null : null });
        }

        const body = await readJsonBody(req);
        const displayName = normalizeDisplayName(body.displayName);
        if (!displayName) {
            return sendJson(res, 400, { error: 'displayName must be 1-50 characters' });
        }

        const { response, data } = await supabaseRestRequest(`/profiles?id=eq.${userIdFilter}`, {
            method: 'PATCH',
            token: accessToken,
            headers: {
                Prefer: 'return=representation'
            },
            body: {
                display_name: displayName,
                updated_at: new Date().toISOString()
            }
        });

        if (!response.ok) {
            return sendJson(res, response.status, { error: 'Failed to update profile', details: data });
        }

        return sendJson(res, 200, { profile: Array.isArray(data) ? data[0] || null : null });
    } catch (error) {
        return sendJson(res, 500, { error: 'Profile request failed', details: error.message });
    }
};
