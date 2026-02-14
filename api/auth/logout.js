const { methodNotAllowed, sendJson } = require('../_lib/http');
const { ACCESS_COOKIE, parseCookies, clearAuthCookies } = require('../_lib/cookies');
const { supabaseAuthRequest } = require('../_lib/supabase');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return methodNotAllowed(req, res, ['POST']);
    }

    try {
        const cookies = parseCookies(req);
        const accessToken = cookies[ACCESS_COOKIE];

        if (accessToken) {
            await supabaseAuthRequest('/auth/v1/logout', {
                method: 'POST',
                token: accessToken
            });
        }

        clearAuthCookies(res);
        return sendJson(res, 200, { ok: true });
    } catch (error) {
        clearAuthCookies(res);
        return sendJson(res, 200, { ok: true, warning: error.message });
    }
};
