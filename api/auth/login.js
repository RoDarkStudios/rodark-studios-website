const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { setAuthCookies } = require('../_lib/cookies');
const { supabaseAuthRequest } = require('../_lib/supabase');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return methodNotAllowed(req, res, ['POST']);
    }

    try {
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (!email || !password) {
            return sendJson(res, 400, { error: 'Email and password are required' });
        }

        const { response, data } = await supabaseAuthRequest('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password }
        });

        if (!response.ok) {
            return sendJson(res, response.status, {
                error: data.error_description || data.msg || 'Invalid email or password'
            });
        }

        setAuthCookies(res, data);

        return sendJson(res, 200, { ok: true });
    } catch (error) {
        return sendJson(res, 500, { error: 'Login request failed', details: error.message });
    }
};
