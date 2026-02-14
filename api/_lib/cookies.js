const ACCESS_COOKIE = 'rd_access_token';
const REFRESH_COOKIE = 'rd_refresh_token';

function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header) {
        return {};
    }

    return header.split(';').reduce((acc, part) => {
        const [rawKey, ...rawValue] = part.trim().split('=');
        if (!rawKey) {
            return acc;
        }
        acc[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join('=') || '');
        return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
    const {
        httpOnly = true,
        secure = process.env.NODE_ENV === 'production',
        sameSite = 'Lax',
        path = '/',
        maxAge
    } = options;

    const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

    if (path) {
        parts.push(`Path=${path}`);
    }

    if (Number.isFinite(maxAge)) {
        parts.push(`Max-Age=${Math.floor(maxAge)}`);
    }

    if (sameSite) {
        parts.push(`SameSite=${sameSite}`);
    }

    if (httpOnly) {
        parts.push('HttpOnly');
    }

    if (secure) {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function setAuthCookies(res, authData) {
    const expiresIn = Number(authData.expires_in) || 3600;
    const accessCookie = serializeCookie(ACCESS_COOKIE, authData.access_token, {
        maxAge: expiresIn
    });
    const refreshCookie = serializeCookie(REFRESH_COOKIE, authData.refresh_token, {
        maxAge: 60 * 60 * 24 * 30
    });
    res.setHeader('Set-Cookie', [accessCookie, refreshCookie]);
}

function clearAuthCookies(res) {
    const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const accessCookie = `${serializeCookie(ACCESS_COOKIE, '', { maxAge: 0 })}; Expires=${expired}`;
    const refreshCookie = `${serializeCookie(REFRESH_COOKIE, '', { maxAge: 0 })}; Expires=${expired}`;
    res.setHeader('Set-Cookie', [accessCookie, refreshCookie]);
}

module.exports = {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    parseCookies,
    setAuthCookies,
    clearAuthCookies
};
