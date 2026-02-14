const { supabaseAdminRestRequest } = require('./supabase');

function encodeFilterValue(value) {
    return encodeURIComponent(String(value || ''));
}

function ensureOkResponse(response, data, fallbackMessage) {
    if (response.ok) {
        return;
    }

    const details = (data && (data.message || data.error_description || data.error || data.hint)) || '';
    throw new Error(details ? `${fallbackMessage}: ${details}` : fallbackMessage);
}

function normalizeUserRecord(record) {
    if (!record) {
        return null;
    }

    return {
        id: record.id,
        email: record.email,
        display_name: record.display_name || 'Player',
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

async function findUserById(userId) {
    const idFilter = encodeFilterValue(userId);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_users?id=eq.${idFilter}&select=id,email,display_name,created_at,updated_at&limit=1`, {
        method: 'GET'
    });

    ensureOkResponse(response, data, 'Failed to load user by ID');
    return normalizeUserRecord(Array.isArray(data) ? data[0] || null : null);
}

async function findUserByEmail(email) {
    const emailFilter = encodeFilterValue(email);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_users?email=eq.${emailFilter}&select=id,email,display_name,created_at,updated_at&limit=1`, {
        method: 'GET'
    });

    ensureOkResponse(response, data, 'Failed to load user by email');
    return normalizeUserRecord(Array.isArray(data) ? data[0] || null : null);
}

async function createUser(email, displayName) {
    const payload = {
        email,
        display_name: displayName || 'Player'
    };

    const { response, data } = await supabaseAdminRestRequest('/passkey_users', {
        method: 'POST',
        headers: {
            Prefer: 'return=representation'
        },
        body: payload
    });

    ensureOkResponse(response, data, 'Failed to create user');
    return normalizeUserRecord(Array.isArray(data) ? data[0] || null : null);
}

async function deleteUserById(userId) {
    const idFilter = encodeFilterValue(userId);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_users?id=eq.${idFilter}`, {
        method: 'DELETE'
    });

    ensureOkResponse(response, data, 'Failed to delete user');
}

async function updateUserDisplayName(userId, displayName) {
    const idFilter = encodeFilterValue(userId);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_users?id=eq.${idFilter}`, {
        method: 'PATCH',
        headers: {
            Prefer: 'return=representation'
        },
        body: {
            display_name: displayName,
            updated_at: new Date().toISOString()
        }
    });

    ensureOkResponse(response, data, 'Failed to update display name');
    return normalizeUserRecord(Array.isArray(data) ? data[0] || null : null);
}

function normalizeCredentialRecord(record) {
    if (!record) {
        return null;
    }

    return {
        id: record.id,
        user_id: record.user_id,
        credential_id: record.credential_id,
        public_key_jwk: record.public_key_jwk,
        sign_count: Number(record.sign_count) || 0,
        transports: Array.isArray(record.transports) ? record.transports : [],
        created_at: record.created_at,
        last_used_at: record.last_used_at
    };
}

async function listCredentialsByUserId(userId) {
    const userIdFilter = encodeFilterValue(userId);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_credentials?user_id=eq.${userIdFilter}&select=id,user_id,credential_id,public_key_jwk,sign_count,transports,created_at,last_used_at`, {
        method: 'GET'
    });

    ensureOkResponse(response, data, 'Failed to load credentials');
    if (!Array.isArray(data)) {
        return [];
    }

    return data.map(normalizeCredentialRecord);
}

async function findCredentialByIdForUser(userId, credentialId) {
    const userIdFilter = encodeFilterValue(userId);
    const credentialFilter = encodeFilterValue(credentialId);

    const { response, data } = await supabaseAdminRestRequest(`/passkey_credentials?user_id=eq.${userIdFilter}&credential_id=eq.${credentialFilter}&select=id,user_id,credential_id,public_key_jwk,sign_count,transports,created_at,last_used_at&limit=1`, {
        method: 'GET'
    });

    ensureOkResponse(response, data, 'Failed to load credential');
    return normalizeCredentialRecord(Array.isArray(data) ? data[0] || null : null);
}

async function createCredential(userId, credentialId, publicKeyJwk, signCount, transports) {
    const payload = {
        user_id: userId,
        credential_id: credentialId,
        public_key_jwk: publicKeyJwk,
        sign_count: Number(signCount) || 0,
        transports: Array.isArray(transports) ? transports : []
    };

    const { response, data } = await supabaseAdminRestRequest('/passkey_credentials', {
        method: 'POST',
        headers: {
            Prefer: 'return=representation'
        },
        body: payload
    });

    ensureOkResponse(response, data, 'Failed to create credential');
    return normalizeCredentialRecord(Array.isArray(data) ? data[0] || null : null);
}

async function updateCredentialCounter(credentialPrimaryId, signCount) {
    const idFilter = encodeFilterValue(credentialPrimaryId);
    const { response, data } = await supabaseAdminRestRequest(`/passkey_credentials?id=eq.${idFilter}`, {
        method: 'PATCH',
        headers: {
            Prefer: 'return=representation'
        },
        body: {
            sign_count: Number(signCount) || 0,
            last_used_at: new Date().toISOString()
        }
    });

    ensureOkResponse(response, data, 'Failed to update credential counter');
    return normalizeCredentialRecord(Array.isArray(data) ? data[0] || null : null);
}

module.exports = {
    findUserById,
    findUserByEmail,
    createUser,
    deleteUserById,
    updateUserDisplayName,
    listCredentialsByUserId,
    findCredentialByIdForUser,
    createCredential,
    updateCredentialCounter
};
