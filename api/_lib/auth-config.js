function getHeaderValue(req, key) {
    const value = req.headers[key];
    if (Array.isArray(value)) {
        return String(value[0] || '').trim();
    }
    return String(value || '').split(',')[0].trim();
}

function getRequestHost(req) {
    return getHeaderValue(req, 'x-forwarded-host') || getHeaderValue(req, 'host');
}

function getRequestProtocol(req) {
    return getHeaderValue(req, 'x-forwarded-proto') || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
}

function getExpectedOrigin(req) {
    if (process.env.AUTH_ORIGIN) {
        return String(process.env.AUTH_ORIGIN).replace(/\/+$/g, '');
    }

    const host = getRequestHost(req);
    const protocol = getRequestProtocol(req);
    if (!host) {
        throw new Error('Unable to determine request host for WebAuthn origin');
    }

    return `${protocol}://${host}`.replace(/\/+$/g, '');
}

function getExpectedRpId(req) {
    if (process.env.AUTH_RP_ID) {
        return process.env.AUTH_RP_ID;
    }

    const host = getRequestHost(req);
    if (!host) {
        throw new Error('Unable to determine request host for WebAuthn RP ID');
    }

    return host.split(':')[0];
}

function getAuthSecret() {
    const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error('AUTH_SECRET must be set');
    }
    return secret;
}

module.exports = {
    getExpectedOrigin,
    getExpectedRpId,
    getAuthSecret
};
