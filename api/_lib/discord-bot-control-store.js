const { postgresQuery } = require('./postgres');

const CONTROL_ID = 1;

async function ensureDiscordBotControlSchema() {
    await postgresQuery(`
        create table if not exists discord_bot_control (
            id smallint primary key check (id = 1),
            desired_enabled boolean not null default false,
            runtime_status text not null default 'offline',
            last_seen_at timestamptz,
            last_error text,
            updated_at timestamptz not null default now(),
            updated_by_user_id text,
            updated_by_username text
        )
    `);

    await postgresQuery(`
        insert into discord_bot_control (id)
        values ($1)
        on conflict (id) do nothing
    `, [CONTROL_ID]);
}

function mapRowToDiscordBotControl(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        desiredEnabled: Boolean(row.desired_enabled),
        runtimeStatus: typeof row.runtime_status === 'string' ? row.runtime_status : 'offline',
        lastSeenAt: row.last_seen_at instanceof Date
            ? row.last_seen_at.toISOString()
            : (typeof row.last_seen_at === 'string' ? row.last_seen_at : null),
        lastError: row.last_error ? String(row.last_error) : null,
        updatedAt: row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : (typeof row.updated_at === 'string' ? row.updated_at : null),
        updatedByUserId: row.updated_by_user_id ? String(row.updated_by_user_id) : null,
        updatedByUsername: row.updated_by_username ? String(row.updated_by_username) : null
    };
}

async function getDiscordBotControl() {
    await ensureDiscordBotControlSchema();

    const result = await postgresQuery(`
        select
            desired_enabled,
            runtime_status,
            last_seen_at,
            last_error,
            updated_at,
            updated_by_user_id,
            updated_by_username
        from discord_bot_control
        where id = $1
        limit 1
    `, [CONTROL_ID]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

async function setDiscordBotDesiredEnabled(desiredEnabled, user) {
    await ensureDiscordBotControlSchema();

    const result = await postgresQuery(`
        update discord_bot_control
        set
            desired_enabled = $2,
            updated_at = now(),
            updated_by_user_id = $3,
            updated_by_username = $4,
            last_error = case when $2 = false then null else last_error end
        where id = $1
        returning
            desired_enabled,
            runtime_status,
            last_seen_at,
            last_error,
            updated_at,
            updated_by_user_id,
            updated_by_username
    `, [
        CONTROL_ID,
        Boolean(desiredEnabled),
        user && user.id ? String(user.id) : null,
        user && user.username ? String(user.username) : null
    ]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

async function setDiscordBotRuntimeStatus(runtimeStatus, lastError) {
    await ensureDiscordBotControlSchema();

    const result = await postgresQuery(`
        update discord_bot_control
        set
            runtime_status = $2,
            last_seen_at = now(),
            last_error = $3
        where id = $1
        returning
            desired_enabled,
            runtime_status,
            last_seen_at,
            last_error,
            updated_at,
            updated_by_user_id,
            updated_by_username
    `, [
        CONTROL_ID,
        String(runtimeStatus || 'offline'),
        lastError ? String(lastError).slice(0, 1000) : null
    ]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

module.exports = {
    ensureDiscordBotControlSchema,
    getDiscordBotControl,
    setDiscordBotDesiredEnabled,
    setDiscordBotRuntimeStatus
};
