const { ACCESS_COOKIE, REFRESH_COOKIE, parseCookies, setAuthCookies, clearAuthCookies } = require('./cookies');
const { supabaseAuthRequest } = require('./supabase');

async function getUserByAccessToken(accessToken) {
    if (!accessToken) {
        return null;
    }

    const { response, data } = await supabaseAuthRequest('/auth/v1/user', {
        method: 'GET',
        token: accessToken
    });

    if (!response.ok) {
        return null;
    }

    return data;
}

async function refreshSession(refreshToken, res) {
    if (!refreshToken) {
        return null;
    }

    const { response, data } = await supabaseAuthRequest('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: refreshToken }
    });

    if (!response.ok || !data.access_token || !data.refresh_token) {
        return null;
    }

    setAuthCookies(res, data);
    return data;
}

async function requireUserFromSession(req, res) {
    const cookies = parseCookies(req);
    let accessToken = cookies[ACCESS_COOKIE];
    const refreshToken = cookies[REFRESH_COOKIE];

    let user = await getUserByAccessToken(accessToken);
    if (user) {
        return { user, accessToken };
    }

    const refreshed = await refreshSession(refreshToken, res);
    if (!refreshed) {
        clearAuthCookies(res);
        return { user: null, accessToken: null };
    }

    accessToken = refreshed.access_token;
    user = await getUserByAccessToken(accessToken);
    if (!user) {
        clearAuthCookies(res);
        return { user: null, accessToken: null };
    }

    return { user, accessToken };
}

module.exports = {
    requireUserFromSession
};
