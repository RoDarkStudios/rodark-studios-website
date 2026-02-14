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
        const displayName = String(body.displayName || '').trim();

        if (!email || !password) {
            return sendJson(res, 400, { error: 'Email and password are required' });
        }

        if (password.length < 8) {
            return sendJson(res, 400, { error: 'Password must be at least 8 characters long' });
        }

        const payload = {
            email,
            password
        };

        if (displayName) {
            payload.data = { display_name: displayName };
        }

        const { response, data } = await supabaseAuthRequest('/auth/v1/signup', {
            method: 'POST',
            body: payload
        });

        if (!response.ok) {
            return sendJson(res, response.status, {
                error: data.error_description || data.msg || 'Signup failed'
            });
        }

        if (data.access_token && data.refresh_token) {
            setAuthCookies(res, data);
        }

        return sendJson(res, 201, {
            ok: true,
            requiresEmailConfirmation: !data.access_token
        });
    } catch (error) {
        return sendJson(res, 500, { error: 'Signup request failed', details: error.message });
    }
};
