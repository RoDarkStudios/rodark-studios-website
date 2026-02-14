const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { parseCookies, serializeCookie, appendSetCookie, WEBAUTHN_STATE_COOKIE, SESSION_COOKIE } = require('../_lib/cookies');
const { issueSignedToken, verifySignedToken } = require('../_lib/signed-token');
const { getAuthSecret, getExpectedOrigin, getExpectedRpId } = require('../_lib/auth-config');
const { randomBase64Url, normalizeTransports, verifyRegistrationCredential } = require('../_lib/webauthn');
const { findUserByEmail, createUser, createCredential, deleteUserById } = require('../_lib/passkey-store');

const WEBAUTHN_STATE_TTL_SECONDS = 60 * 5;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeDisplayName(value) {
    const displayName = String(value || '').trim();
    if (!displayName) {
        return 'Player';
    }
    if (displayName.length > 50) {
        return null;
    }
    return displayName;
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
    const displayName = normalizeDisplayName(body.displayName);

    if (!email || !email.includes('@')) {
        return sendJson(res, 400, { error: 'A valid email is required' });
    }

    if (!displayName) {
        return sendJson(res, 400, { error: 'displayName must be 1-50 characters' });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
        return sendJson(res, 409, { error: 'An account with this email already exists' });
    }

    const challenge = randomBase64Url(32);
    const userHandle = randomBase64Url(32);

    const stateToken = issueSignedToken({
        type: 'signup',
        challenge,
        email,
        displayName,
        userHandle
    }, getAuthSecret(), WEBAUTHN_STATE_TTL_SECONDS);

    setWebAuthnStateCookie(res, stateToken);

    return sendJson(res, 200, {
        options: {
            challenge,
            rp: {
                id: getExpectedRpId(req),
                name: 'RoDark Studios'
            },
            user: {
                id: userHandle,
                name: email,
                displayName
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 60000,
            attestation: 'none',
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'required',
                userVerification: 'required'
            },
            excludeCredentials: []
        }
    });
}

async function handleVerify(req, res, body) {
    const state = getStateFromCookie(req);
    if (!state || state.type !== 'signup') {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Signup session expired. Please try again.' });
    }

    const credential = validateCredentialPayload(body);
    if (!credential) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: 'Credential payload is required' });
    }

    let verification;
    try {
        verification = verifyRegistrationCredential({
            credential,
            expectedChallenge: state.challenge,
            expectedOrigin: getExpectedOrigin(req),
            expectedRpId: getExpectedRpId(req)
        });
    } catch (error) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 400, { error: error.message || 'Passkey registration verification failed' });
    }

    const existingUser = await findUserByEmail(state.email);
    if (existingUser) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 409, { error: 'An account with this email already exists' });
    }

    let user;
    try {
        user = await createUser(state.email, state.displayName);
    } catch (error) {
        clearWebAuthnStateCookie(res);
        return sendJson(res, 500, { error: 'Failed to create user', details: error.message });
    }

    try {
        await createCredential(
            user.id,
            verification.credentialId,
            verification.publicKeyJwk,
            verification.signCount,
            normalizeTransports(credential.response && credential.response.transports)
        );
    } catch (error) {
        try {
            await deleteUserById(user.id);
        } catch (cleanupError) {
            // Best-effort cleanup to avoid orphaned users when credential insert fails.
        }
        clearWebAuthnStateCookie(res);
        return sendJson(res, 500, { error: 'Failed to create passkey credential', details: error.message });
    }

    const sessionToken = issueSignedToken({
        type: 'session',
        sub: user.id,
        email: user.email
    }, getAuthSecret(), SESSION_TTL_SECONDS);

    setSessionCookie(res, sessionToken);
    clearWebAuthnStateCookie(res);

    return sendJson(res, 201, {
        ok: true,
        user: {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            user_metadata: {
                display_name: user.display_name
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
        return sendJson(res, 500, { error: 'Signup request failed', details: error.message });
    }
};
