const SUPABASE_REST_PATH = '/rest/v1/admin_game_config';

function getSupabaseConfig() {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    return {
        url: url.replace(/\/+$/, ''),
        serviceRoleKey
    };
}

function parseJsonOrNull(text) {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function extractSupabaseErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') {
        return fallback;
    }

    const directMessage = [payload.message, payload.error, payload.details, payload.hint]
        .find((value) => typeof value === 'string' && value.trim());
    if (directMessage) {
        return directMessage.trim();
    }

    return fallback;
}

async function supabaseRequest({ method, query, body, headers }) {
    const config = getSupabaseConfig();
    const url = new URL(`${config.url}${SUPABASE_REST_PATH}`);
    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === '') {
                continue;
            }
            url.searchParams.set(key, String(value));
        }
    }

    const requestHeaders = {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`
    };

    if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
            if (value === undefined || value === null || value === '') {
                continue;
            }
            requestHeaders[key] = String(value);
        }
    }

    const options = {
        method,
        headers: requestHeaders
    };

    if (body !== undefined) {
        requestHeaders['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const responseText = await response.text();
    const payload = parseJsonOrNull(responseText);

    if (!response.ok) {
        const fallback = `Supabase request failed (${response.status})`;
        throw new Error(extractSupabaseErrorMessage(payload, fallback));
    }

    if (payload !== null) {
        return payload;
    }

    return responseText;
}

function toPositiveInteger(value, fieldName) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} is invalid in stored game config`);
    }
    return parsed;
}

function mapRowToConfig(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        productionUniverseId: toPositiveInteger(row.production_universe_id, 'production_universe_id'),
        testUniverseId: toPositiveInteger(row.test_universe_id, 'test_universe_id'),
        developmentUniverseId: toPositiveInteger(row.development_universe_id, 'development_universe_id'),
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
        updatedByUserId: row.updated_by_user_id !== undefined && row.updated_by_user_id !== null
            ? String(row.updated_by_user_id)
            : null,
        updatedByUsername: row.updated_by_username !== undefined && row.updated_by_username !== null
            ? String(row.updated_by_username)
            : null
    };
}

async function getStoredGameConfig() {
    const rows = await supabaseRequest({
        method: 'GET',
        query: {
            id: 'eq.1',
            select: [
                'id',
                'production_universe_id',
                'test_universe_id',
                'development_universe_id',
                'updated_at',
                'updated_by_user_id',
                'updated_by_username'
            ].join(','),
            limit: 1
        }
    });

    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }

    return mapRowToConfig(rows[0]);
}

async function saveStoredGameConfig(config) {
    const payload = {
        id: 1,
        production_universe_id: Number(config && config.productionUniverseId),
        test_universe_id: Number(config && config.testUniverseId),
        development_universe_id: Number(config && config.developmentUniverseId),
        updated_by_user_id: config && config.updatedByUserId ? String(config.updatedByUserId) : null,
        updated_by_username: config && config.updatedByUsername ? String(config.updatedByUsername) : null,
        updated_at: new Date().toISOString()
    };

    const rows = await supabaseRequest({
        method: 'POST',
        query: {
            on_conflict: 'id',
            select: [
                'id',
                'production_universe_id',
                'test_universe_id',
                'development_universe_id',
                'updated_at',
                'updated_by_user_id',
                'updated_by_username'
            ].join(',')
        },
        headers: {
            Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: [payload]
    });

    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Supabase upsert returned no game config row');
    }

    return mapRowToConfig(rows[0]);
}

module.exports = {
    getStoredGameConfig,
    saveStoredGameConfig
};
