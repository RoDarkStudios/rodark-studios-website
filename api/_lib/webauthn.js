const crypto = require('crypto');
const { decodeFirst } = require('./cbor');
const { toBase64Url, fromBase64Url } = require('./base64url');

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest();
}

function randomBase64Url(size = 32) {
    return toBase64Url(crypto.randomBytes(size));
}

function normalizeTransports(transports) {
    if (!Array.isArray(transports)) {
        return [];
    }

    return transports
        .map((transport) => String(transport || '').trim())
        .filter(Boolean)
        .slice(0, 5);
}

function parseClientDataJSON(base64UrlValue) {
    const raw = fromBase64Url(base64UrlValue);
    let parsed;

    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch (error) {
        throw new Error('Invalid clientDataJSON');
    }

    return { raw, parsed };
}

function parseAuthenticatorData(authDataBuffer) {
    if (!Buffer.isBuffer(authDataBuffer) || authDataBuffer.length < 37) {
        throw new Error('Invalid authenticator data');
    }

    const rpIdHash = authDataBuffer.slice(0, 32);
    const flags = authDataBuffer.readUInt8(32);
    const signCount = authDataBuffer.readUInt32BE(33);

    const result = {
        rpIdHash,
        flags,
        userPresent: (flags & FLAG_USER_PRESENT) !== 0,
        userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
        signCount,
        credentialId: null,
        cosePublicKey: null
    };

    if ((flags & FLAG_ATTESTED_DATA) === 0) {
        return result;
    }

    let offset = 37;

    if (offset + 16 > authDataBuffer.length) {
        throw new Error('Invalid attested credential data (AAGUID)');
    }

    offset += 16;

    if (offset + 2 > authDataBuffer.length) {
        throw new Error('Invalid attested credential data (credential length)');
    }

    const credentialIdLength = authDataBuffer.readUInt16BE(offset);
    offset += 2;

    if (offset + credentialIdLength > authDataBuffer.length) {
        throw new Error('Invalid attested credential data (credential ID)');
    }

    const credentialId = authDataBuffer.slice(offset, offset + credentialIdLength);
    offset += credentialIdLength;

    const coseDecoded = decodeFirst(authDataBuffer, offset);
    const cosePublicKey = authDataBuffer.slice(offset, coseDecoded.offset);

    result.credentialId = credentialId;
    result.cosePublicKey = cosePublicKey;

    return result;
}

function coseEc2ToJwk(cosePublicKeyBuffer) {
    const decoded = decodeFirst(cosePublicKeyBuffer);
    if (!(decoded.value instanceof Map)) {
        throw new Error('Invalid COSE public key');
    }

    const map = decoded.value;
    const kty = map.get(1);
    const alg = map.get(3);
    const crv = map.get(-1);
    const x = map.get(-2);
    const y = map.get(-3);

    if (kty !== 2 || crv !== 1 || alg !== -7) {
        throw new Error('Unsupported credential algorithm. Expected ES256');
    }

    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
        throw new Error('Invalid EC key coordinates');
    }

    return {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(x),
        y: toBase64Url(y),
        alg: 'ES256',
        ext: true
    };
}

function getCredentialIdFromPayload(credential) {
    if (!credential || typeof credential !== 'object') {
        return null;
    }

    const rawId = credential.rawId || credential.id;
    if (!rawId) {
        return null;
    }

    try {
        const buffer = fromBase64Url(String(rawId));
        return toBase64Url(buffer);
    } catch (error) {
        return null;
    }
}

function ensureOriginMatch(actualOrigin, expectedOrigin) {
    if (actualOrigin !== expectedOrigin) {
        throw new Error('Origin mismatch');
    }
}

function ensureChallengeMatch(actualChallenge, expectedChallenge) {
    if (actualChallenge !== expectedChallenge) {
        throw new Error('Challenge mismatch');
    }
}

function ensureRpIdMatch(authData, expectedRpId) {
    const expectedHash = sha256(expectedRpId);
    if (!authData.rpIdHash.equals(expectedHash)) {
        throw new Error('RP ID hash mismatch');
    }
}

function verifyRegistrationCredential(params) {
    const {
        credential,
        expectedChallenge,
        expectedOrigin,
        expectedRpId
    } = params;

    if (!credential || credential.type !== 'public-key') {
        throw new Error('Invalid credential type');
    }

    if (!credential.response || !credential.response.clientDataJSON || !credential.response.attestationObject) {
        throw new Error('Invalid credential response');
    }

    const { raw: clientDataRaw, parsed: clientData } = parseClientDataJSON(credential.response.clientDataJSON);

    if (clientData.type !== 'webauthn.create') {
        throw new Error('Invalid WebAuthn ceremony type for registration');
    }

    ensureChallengeMatch(clientData.challenge, expectedChallenge);
    ensureOriginMatch(clientData.origin, expectedOrigin);

    const attestationObject = fromBase64Url(credential.response.attestationObject);
    const decodedAttestation = decodeFirst(attestationObject);

    if (!(decodedAttestation.value instanceof Map)) {
        throw new Error('Invalid attestation object');
    }

    const authDataBuffer = decodedAttestation.value.get('authData');
    if (!Buffer.isBuffer(authDataBuffer)) {
        throw new Error('Missing authenticator data in attestation');
    }

    const authData = parseAuthenticatorData(authDataBuffer);
    ensureRpIdMatch(authData, expectedRpId);

    if (!authData.userPresent || !authData.userVerified) {
        throw new Error('Passkey verification requires user presence and verification');
    }

    if (!authData.credentialId || !authData.cosePublicKey) {
        throw new Error('Missing attested credential data');
    }

    const publicKeyJwk = coseEc2ToJwk(authData.cosePublicKey);

    return {
        credentialId: toBase64Url(authData.credentialId),
        publicKeyJwk,
        signCount: authData.signCount,
        clientDataJSONHash: sha256(clientDataRaw)
    };
}

function verifyAuthenticationCredential(params) {
    const {
        credential,
        expectedChallenge,
        expectedOrigin,
        expectedRpId,
        expectedCredentialId,
        storedPublicKeyJwk,
        storedSignCount = 0
    } = params;

    if (!credential || credential.type !== 'public-key') {
        throw new Error('Invalid credential type');
    }

    if (!credential.response || !credential.response.clientDataJSON || !credential.response.authenticatorData || !credential.response.signature) {
        throw new Error('Invalid assertion response');
    }

    const parsedCredentialId = getCredentialIdFromPayload(credential);
    if (!parsedCredentialId || parsedCredentialId !== expectedCredentialId) {
        throw new Error('Credential ID mismatch');
    }

    const { raw: clientDataRaw, parsed: clientData } = parseClientDataJSON(credential.response.clientDataJSON);

    if (clientData.type !== 'webauthn.get') {
        throw new Error('Invalid WebAuthn ceremony type for authentication');
    }

    ensureChallengeMatch(clientData.challenge, expectedChallenge);
    ensureOriginMatch(clientData.origin, expectedOrigin);

    const authDataBuffer = fromBase64Url(credential.response.authenticatorData);
    const signatureBuffer = fromBase64Url(credential.response.signature);

    const authData = parseAuthenticatorData(authDataBuffer);
    ensureRpIdMatch(authData, expectedRpId);

    if (!authData.userPresent || !authData.userVerified) {
        throw new Error('Passkey sign-in requires user presence and verification');
    }

    const clientDataHash = sha256(clientDataRaw);
    const signedPayload = Buffer.concat([authDataBuffer, clientDataHash]);

    const publicKey = crypto.createPublicKey({
        key: storedPublicKeyJwk,
        format: 'jwk'
    });

    const verified = crypto.verify('sha256', signedPayload, publicKey, signatureBuffer);
    if (!verified) {
        throw new Error('Invalid passkey signature');
    }

    if (storedSignCount > 0 && authData.signCount > 0 && authData.signCount <= storedSignCount) {
        throw new Error('Credential signature counter did not advance');
    }

    return {
        signCount: authData.signCount,
        credentialId: parsedCredentialId
    };
}

module.exports = {
    randomBase64Url,
    normalizeTransports,
    getCredentialIdFromPayload,
    verifyRegistrationCredential,
    verifyAuthenticationCredential
};
