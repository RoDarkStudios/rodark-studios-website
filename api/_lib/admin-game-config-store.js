const SUPABASE_REST_PATH = '/rest/v1/admin_game_config';
let postgresPool;

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

function hasSupabaseConfig() {
    return Boolean(String(process.env.SUPABASE_URL || '').trim())
        && Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
}

function getDatabaseUrl() {
    return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
}

function hasPostgresConfig() {
    return Boolean(getDatabaseUrl());
}

function getPostgresPool() {
    if (postgresPool) {
        return postgresPool;
    }

    const connectionString = getDatabaseUrl();
    if (!connectionString) {
        throw new Error('DATABASE_URL must be set');
    }

    const { Pool } = require('pg');
    postgresPool = new Pool({
        connectionString,
        ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false }
    });

    return postgresPool;
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

async function postgresQuery(text, params) {
    const pool = getPostgresPool();
    return pool.query(text, params);
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

async function getStoredGameConfigFromPostgres() {
    const result = await postgresQuery(`
        select
            id,
            production_universe_id,
            test_universe_id,
            development_universe_id,
            updated_at,
            updated_by_user_id,
            updated_by_username
        from admin_game_config
        where id = 1
        limit 1
    `);

    if (!result.rows.length) {
        return null;
    }

    return mapRowToConfig(result.rows[0]);
}

async function getStoredGameConfigFromSupabase() {
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

async function getStoredGameConfig() {
    if (hasPostgresConfig()) {
        const postgresConfig = await getStoredGameConfigFromPostgres();
        if (postgresConfig || !hasSupabaseConfig()) {
            return postgresConfig;
        }

        return getStoredGameConfigFromSupabase();
    }

    return getStoredGameConfigFromSupabase();
}

async function saveStoredGameConfigToPostgres(config) {
    const result = await postgresQuery(`
        insert into admin_game_config (
            id,
            production_universe_id,
            test_universe_id,
            development_universe_id,
            updated_by_user_id,
            updated_by_username,
            updated_at
        )
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (id) do update set
            production_universe_id = excluded.production_universe_id,
            test_universe_id = excluded.test_universe_id,
            development_universe_id = excluded.development_universe_id,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_by_username = excluded.updated_by_username,
            updated_at = excluded.updated_at
        returning
            id,
            production_universe_id,
            test_universe_id,
            development_universe_id,
            updated_at,
            updated_by_user_id,
            updated_by_username
    `, [
        1,
        Number(config && config.productionUniverseId),
        Number(config && config.testUniverseId),
        Number(config && config.developmentUniverseId),
        config && config.updatedByUserId ? String(config.updatedByUserId) : null,
        config && config.updatedByUsername ? String(config.updatedByUsername) : null
    ]);

    if (!result.rows.length) {
        throw new Error('Postgres upsert returned no game config row');
    }

    return mapRowToConfig(result.rows[0]);
}

async function saveStoredGameConfigToSupabase(config) {
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

async function saveStoredGameConfig(config) {
    if (hasPostgresConfig()) {
        return saveStoredGameConfigToPostgres(config);
    }

    return saveStoredGameConfigToSupabase(config);
}

module.exports = {
    getStoredGameConfig,
    saveStoredGameConfig
};
