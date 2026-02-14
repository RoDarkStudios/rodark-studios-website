const { SESSION_COOKIE, parseCookies, clearAuthCookies } = require('./cookies');
const { verifySignedToken } = require('./signed-token');
const { getAuthSecret } = require('./auth-config');
const { findUserById } = require('./passkey-store');

async function requireUserFromSession(req, res) {
    const cookies = parseCookies(req);
    const sessionToken = cookies[SESSION_COOKIE];

    if (!sessionToken) {
        return { user: null, accessToken: null };
    }

    let payload;
    try {
        payload = verifySignedToken(sessionToken, getAuthSecret());
    } catch (error) {
        clearAuthCookies(res);
        return { user: null, accessToken: null };
    }

    if (!payload || payload.type !== 'session' || !payload.sub) {
        clearAuthCookies(res);
        return { user: null, accessToken: null };
    }

    let user;
    try {
        user = await findUserById(payload.sub);
    } catch (error) {
        return { user: null, accessToken: null };
    }

    if (!user) {
        clearAuthCookies(res);
        return { user: null, accessToken: null };
    }

    return { user, accessToken: null };
}

module.exports = {
    requireUserFromSession
};
