const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SUPABASE_REST_PATH = '/rest/v1/admin_game_config';

function getRequiredEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`${name} must be set`);
    }
    return value;
}

function getPostgresPool() {
    const connectionString = getRequiredEnv('DATABASE_URL');
    return new Pool({
        connectionString,
        ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false }
    });
}

async function fetchSupabaseConfig() {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL').replace(/\/+$/, '');
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const requestUrl = new URL(`${supabaseUrl}${SUPABASE_REST_PATH}`);
    requestUrl.searchParams.set('id', 'eq.1');
    requestUrl.searchParams.set('select', [
        'id',
        'production_universe_id',
        'test_universe_id',
        'development_universe_id',
        'updated_at',
        'updated_by_user_id',
        'updated_by_username'
    ].join(','));
    requestUrl.searchParams.set('limit', '1');

    const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
        }
    });

    const bodyText = await response.text();
    const payload = bodyText ? JSON.parse(bodyText) : null;
    if (!response.ok) {
        const detail = payload && (payload.message || payload.error || payload.details || payload.hint);
        throw new Error(detail || `Supabase request failed (${response.status})`);
    }

    if (!Array.isArray(payload) || payload.length === 0) {
        return null;
    }

    return payload[0];
}

async function ensurePostgresSchema(pool) {
    const schemaPath = path.join(__dirname, '..', 'railway', 'postgres-schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
}

async function upsertPostgresConfig(pool, row) {
    await pool.query(`
        insert into admin_game_config (
            id,
            production_universe_id,
            test_universe_id,
            development_universe_id,
            updated_by_user_id,
            updated_by_username,
            updated_at
        )
        values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
        on conflict (id) do update set
            production_universe_id = excluded.production_universe_id,
            test_universe_id = excluded.test_universe_id,
            development_universe_id = excluded.development_universe_id,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_by_username = excluded.updated_by_username,
            updated_at = excluded.updated_at
    `, [
        1,
        row.production_universe_id,
        row.test_universe_id,
        row.development_universe_id,
        row.updated_by_user_id || null,
        row.updated_by_username || null,
        row.updated_at || null
    ]);
}

async function main() {
    const row = await fetchSupabaseConfig();
    if (!row) {
        console.log('No Supabase admin_game_config row found. Created schema only.');
    }

    const pool = getPostgresPool();
    try {
        await ensurePostgresSchema(pool);
        if (row) {
            await upsertPostgresConfig(pool, row);
            console.log('Migrated admin_game_config row to Railway Postgres.');
        }
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
