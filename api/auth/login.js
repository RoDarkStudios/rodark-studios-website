const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { parseCookies, serializeCookie, appendSetCookie, WEBAUTHN_STATE_COOKIE, SESSION_COOKIE } = require('../_lib/cookies');
const { issueSignedToken, verifySignedToken } = require('../_lib/signed-token');
const { getAuthSecret, getExpectedOrigin, getExpectedRpId } = require('../_lib/auth-config');
const { randomBase64Url, getCredentialIdFromPayload, verifyAuthenticationCredential } = require('../_lib/webauthn');
const {
    findUserByEmail,
    findUserById,
    listCredentialsByUserId,
    findCredentialByIdForUser,
    updateCredentialCounter
} = require('../_lib/passkey-store');

const WEBAUTHN_STATE_TTL_SECONDS = 60 * 5;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function setWebAuthnStateCookie(res, token) {
    appendSetCookie(res, serializeCookie(WEBAUTHN_STATE_COOKIE, token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: WEBAUTHN_STATE_TTL_SECONDS
    }));
}

function clearWebAuthnStateCookie(res) {
    appendSetCookie(res, serializeCookie(WEBAUTHN_STATE_COOKIE, '', {
        httpOnly: true,
        sameSite: 'Lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0
    }));
}

function setSessionCookie(res, token) {
    appendSetCookie(res, serializeCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_TTL_SECONDS
    }));
}

function getStateFromCookie(req) {
    const cookies = parseCookies(req);
    const token = cookies[WEBAUTHN_STATE_COOKIE];
    if (!token) {
        return null;
    }

    return verifySignedToken(token, getAuthSecret());
}

function validateCredentialPayload(body) {
    if (!body || typeof body !== 'object' || !body.credential || typeof body.credential !== 'object') {
        return null;
    }

    return body.credential;
}

async function handleOptions(req, res, body) {
    const email = normalizeEmail(body.email);
    if (!email || !email.includes('@')) {
        return sendJson(res, 400, { error: 'A valid email is required' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
        return sendJson(res, 404, { error: 'No account found for this email' });
    }

    const credentials = await listCredentialsByUserId(user.id);
    if (!credentials.length) {
        return sendJson(res, 400, { error: 'No passkeys registered for this account' });
    }

    const challenge = randomBase64Url(32);
    const allowedCredentialIds = credentials.map((item) => item.credential_id);

    const stateToken = issueSignedToken({
        type: 'login',
        challenge,
        userId: user.id,
        email: user.email,
        allowedCredentialIds
    }, getAuthSecret(), WEBAUTHN_STATE_TTL_SECONDS);

    setWebAuthnStateCookie(res, stateToken);

    return sendJson(res, 200, {
        options: {
            challenge,
            rpId: getExpectedRpId(req),
            timeout: 60000,
            userVerification: 'required',
            allowCredentials: credentials.map((item) => ({
                id: item.credential_id,
                type: 'public-key',
                transports: Array.isArray(item.transports) ? item.transports : []
            }))
        }
    });
}

async function handleVerify(req, res, body) {
    const state = getStateFromCookie(req);
    if (!state || state.type !== 'login' || !state.userId || !Array.isArray(state.allowedCredentialIds)) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Login session expired. Please try again.' });
    }

    const credential = validateCredentialPayload(body);
    if (!credential) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Credential payload is required' });
    }

    const credentialId = getCredentialIdFromPayload(credential);
    if (!credentialId || !state.allowedCredentialIds.includes(credentialId)) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Credential is not allowed for this login challenge' });
    }

    const credentialRecord = await findCredentialByIdForUser(state.userId, credentialId);
    if (!credentialRecord) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Credential not found' });
    }

    let verification;
    try {
        verification = verifyAuthenticationCredential({
            credential,
            expectedChallenge: state.challenge,
            expectedOrigin: getExpectedOrigin(req),
            expectedRpId: getExpectedRpId(req),
            expectedCredentialId: credentialRecord.credential_id,
            storedPublicKeyJwk: credentialRecord.public_key_jwk,
            storedSignCount: credentialRecord.sign_count
        });
    } catch (error) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: error.message || 'Passkey sign-in verification failed' });
    }

    try {
        await updateCredentialCounter(credentialRecord.id, verification.signCount);
    } catch (error) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 500, { error: 'Failed to update credential counter', details: error.message });
    }

    const user = await findUserById(state.userId);
    if (!user) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Account no longer exists' });
    }

    const sessionToken = issueSignedToken({
        type: 'session',
        sub: user.id,
        email: user.email
    }, getAuthSecret(), SESSION_TTL_SECONDS);

    setSessionCookie(res, sessionToken);
    clearWebAuthnStateCookie(res);

    return sendJson(res, 200, {
        ok: true,
        user: {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            user_metadata: {
                username: user.username
            }
        }
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return methodNotAllowed(req, res, ['POST']);
    }

    try {
        const body = await readJsonBody(req);
        const action = String(body.action || '').trim().toLowerCase();

        if (action === 'options') {
            return await handleOptions(req, res, body);
        }

        if (action === 'verify') {
            return await handleVerify(req, res, body);
        }

        return sendJson(res, 400, { error: 'Invalid action. Use "options" or "verify".' });
    } catch (error) {
        return sendJson(res, 500, { error: 'Login request failed', details: error.message });
    }
};
