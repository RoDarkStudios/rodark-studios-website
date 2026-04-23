const { postgresQuery } = require('./postgres');

const CONTROL_ID = 1;
const THREAD_STATUS_ACTIVE = 'active';
const THREAD_STATUS_HANDED_OFF = 'handed_off';

function toIsoString(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return typeof value === 'string' ? value : null;
}

function normalizeOptionalSnowflake(value, fieldName) {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
        return null;
    }

    if (!/^\d{5,25}$/.test(trimmed)) {
        throw new Error(`${fieldName} must be a valid Discord ID`);
    }

    return trimmed;
}

function normalizeRequiredSnowflake(value, fieldName) {
    const normalized = normalizeOptionalSnowflake(value, fieldName);
    if (!normalized) {
        throw new Error(`${fieldName} is required`);
    }
    return normalized;
}

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
        alter table discord_bot_control
        add column if not exists ai_ticket_assistant_enabled boolean not null default false
    `);

    await postgresQuery(`
        alter table discord_bot_control
        add column if not exists ai_ticket_category_id text
    `);

    await postgresQuery(`
        alter table discord_bot_control
        add column if not exists ai_ticket_owner_role_id text
    `);

    await postgresQuery(`
        create table if not exists discord_bot_ticket_assistant_threads (
            channel_id text primary key,
            guild_id text not null,
            category_id text not null,
            requester_user_id text,
            requester_username text,
            status text not null default 'active',
            status_reason text,
            greeted_at timestamptz,
            handed_off_at timestamptz,
            last_ai_response_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
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
        lastSeenAt: toIsoString(row.last_seen_at),
        lastError: row.last_error ? String(row.last_error) : null,
        updatedAt: toIsoString(row.updated_at),
        updatedByUserId: row.updated_by_user_id ? String(row.updated_by_user_id) : null,
        updatedByUsername: row.updated_by_username ? String(row.updated_by_username) : null,
        aiTicketAssistant: {
            enabled: Boolean(row.ai_ticket_assistant_enabled),
            ticketCategoryId: row.ai_ticket_category_id ? String(row.ai_ticket_category_id) : null,
            ownerRoleId: row.ai_ticket_owner_role_id ? String(row.ai_ticket_owner_role_id) : null
        }
    };
}

function mapRowToTicketThread(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        channelId: row.channel_id ? String(row.channel_id) : null,
        guildId: row.guild_id ? String(row.guild_id) : null,
        categoryId: row.category_id ? String(row.category_id) : null,
        requesterUserId: row.requester_user_id ? String(row.requester_user_id) : null,
        requesterUsername: row.requester_username ? String(row.requester_username) : null,
        status: row.status ? String(row.status) : THREAD_STATUS_ACTIVE,
        statusReason: row.status_reason ? String(row.status_reason) : null,
        greetedAt: toIsoString(row.greeted_at),
        handedOffAt: toIsoString(row.handed_off_at),
        lastAiResponseAt: toIsoString(row.last_ai_response_at),
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at)
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
            updated_by_username,
            ai_ticket_assistant_enabled,
            ai_ticket_category_id,
            ai_ticket_owner_role_id
        from discord_bot_control
        where id = $1
        limit 1
    `, [CONTROL_ID]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

async function updateDiscordBotControl(patch, user) {
    await ensureDiscordBotControlSchema();

    const currentControl = await getDiscordBotControl();
    if (!currentControl) {
        throw new Error('Discord bot control row is unavailable');
    }

    const desiredEnabled = patch && Object.prototype.hasOwnProperty.call(patch, 'desiredEnabled')
        ? Boolean(patch.desiredEnabled)
        : currentControl.desiredEnabled;
    const aiTicketAssistantEnabled = patch && Object.prototype.hasOwnProperty.call(patch, 'aiTicketAssistantEnabled')
        ? Boolean(patch.aiTicketAssistantEnabled)
        : Boolean(currentControl.aiTicketAssistant && currentControl.aiTicketAssistant.enabled);
    const aiTicketCategoryId = patch && Object.prototype.hasOwnProperty.call(patch, 'aiTicketCategoryId')
        ? normalizeOptionalSnowflake(patch.aiTicketCategoryId, 'AI ticket category ID')
        : (currentControl.aiTicketAssistant && currentControl.aiTicketAssistant.ticketCategoryId
            ? String(currentControl.aiTicketAssistant.ticketCategoryId)
            : null);
    const aiTicketOwnerRoleId = patch && Object.prototype.hasOwnProperty.call(patch, 'aiTicketOwnerRoleId')
        ? normalizeOptionalSnowflake(patch.aiTicketOwnerRoleId, 'AI ticket owner role ID')
        : (currentControl.aiTicketAssistant && currentControl.aiTicketAssistant.ownerRoleId
            ? String(currentControl.aiTicketAssistant.ownerRoleId)
            : null);

    if (aiTicketAssistantEnabled && !aiTicketCategoryId) {
        throw new Error('AI ticket category ID is required when the AI ticket assistant is enabled');
    }

    if (aiTicketAssistantEnabled && !aiTicketOwnerRoleId) {
        throw new Error('AI ticket owner role ID is required when the AI ticket assistant is enabled');
    }

    const result = await postgresQuery(`
        update discord_bot_control
        set
            desired_enabled = $2,
            ai_ticket_assistant_enabled = $3,
            ai_ticket_category_id = $4,
            ai_ticket_owner_role_id = $5,
            updated_at = now(),
            updated_by_user_id = $6,
            updated_by_username = $7,
            last_error = case when $2 = false then null else last_error end
        where id = $1
        returning
            desired_enabled,
            runtime_status,
            last_seen_at,
            last_error,
            updated_at,
            updated_by_user_id,
            updated_by_username,
            ai_ticket_assistant_enabled,
            ai_ticket_category_id,
            ai_ticket_owner_role_id
    `, [
        CONTROL_ID,
        desiredEnabled,
        aiTicketAssistantEnabled,
        aiTicketCategoryId,
        aiTicketOwnerRoleId,
        user && user.id ? String(user.id) : null,
        user && user.username ? String(user.username) : null
    ]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

async function setDiscordBotDesiredEnabled(desiredEnabled, user) {
    return updateDiscordBotControl({ desiredEnabled }, user);
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
            updated_by_username,
            ai_ticket_assistant_enabled,
            ai_ticket_category_id,
            ai_ticket_owner_role_id
    `, [
        CONTROL_ID,
        String(runtimeStatus || 'offline'),
        lastError ? String(lastError).slice(0, 1000) : null
    ]);

    return mapRowToDiscordBotControl(result.rows[0]);
}

async function getDiscordBotTicketThread(channelId) {
    await ensureDiscordBotControlSchema();

    const normalizedChannelId = normalizeRequiredSnowflake(channelId, 'Ticket channel ID');
    const result = await postgresQuery(`
        select
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
        from discord_bot_ticket_assistant_threads
        where channel_id = $1
        limit 1
    `, [normalizedChannelId]);

    return mapRowToTicketThread(result.rows[0]);
}

async function ensureDiscordBotTicketThread(thread) {
    await ensureDiscordBotControlSchema();

    const channelId = normalizeRequiredSnowflake(thread && thread.channelId, 'Ticket channel ID');
    const guildId = normalizeRequiredSnowflake(thread && thread.guildId, 'Ticket guild ID');
    const categoryId = normalizeRequiredSnowflake(thread && thread.categoryId, 'Ticket category ID');

    const result = await postgresQuery(`
        insert into discord_bot_ticket_assistant_threads (
            channel_id,
            guild_id,
            category_id,
            status,
            updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (channel_id) do update set
            guild_id = excluded.guild_id,
            category_id = excluded.category_id,
            updated_at = now()
        returning
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
    `, [channelId, guildId, categoryId, THREAD_STATUS_ACTIVE]);

    return mapRowToTicketThread(result.rows[0]);
}

async function markDiscordBotTicketThreadGreeted(thread) {
    await ensureDiscordBotControlSchema();

    const channelId = normalizeRequiredSnowflake(thread && thread.channelId, 'Ticket channel ID');
    const guildId = normalizeRequiredSnowflake(thread && thread.guildId, 'Ticket guild ID');
    const categoryId = normalizeRequiredSnowflake(thread && thread.categoryId, 'Ticket category ID');

    const result = await postgresQuery(`
        insert into discord_bot_ticket_assistant_threads (
            channel_id,
            guild_id,
            category_id,
            status,
            greeted_at,
            updated_at
        )
        values ($1, $2, $3, $4, now(), now())
        on conflict (channel_id) do update set
            guild_id = excluded.guild_id,
            category_id = excluded.category_id,
            greeted_at = coalesce(discord_bot_ticket_assistant_threads.greeted_at, excluded.greeted_at),
            updated_at = now()
        returning
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
    `, [channelId, guildId, categoryId, THREAD_STATUS_ACTIVE]);

    return mapRowToTicketThread(result.rows[0]);
}

async function setDiscordBotTicketThreadRequester(thread, requester) {
    await ensureDiscordBotControlSchema();

    const channelId = normalizeRequiredSnowflake(thread && thread.channelId, 'Ticket channel ID');
    const guildId = normalizeRequiredSnowflake(thread && thread.guildId, 'Ticket guild ID');
    const categoryId = normalizeRequiredSnowflake(thread && thread.categoryId, 'Ticket category ID');
    const requesterUserId = normalizeRequiredSnowflake(requester && requester.userId, 'Requester user ID');
    const requesterUsername = requester && requester.username ? String(requester.username).trim().slice(0, 120) : null;

    const result = await postgresQuery(`
        insert into discord_bot_ticket_assistant_threads (
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            updated_at
        )
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (channel_id) do update set
            guild_id = excluded.guild_id,
            category_id = excluded.category_id,
            requester_user_id = coalesce(discord_bot_ticket_assistant_threads.requester_user_id, excluded.requester_user_id),
            requester_username = coalesce(discord_bot_ticket_assistant_threads.requester_username, excluded.requester_username),
            updated_at = now()
        returning
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
    `, [
        channelId,
        guildId,
        categoryId,
        requesterUserId,
        requesterUsername,
        THREAD_STATUS_ACTIVE
    ]);

    return mapRowToTicketThread(result.rows[0]);
}

async function markDiscordBotTicketThreadHandedOff(thread, statusReason) {
    await ensureDiscordBotControlSchema();

    const channelId = normalizeRequiredSnowflake(thread && thread.channelId, 'Ticket channel ID');
    const guildId = normalizeRequiredSnowflake(thread && thread.guildId, 'Ticket guild ID');
    const categoryId = normalizeRequiredSnowflake(thread && thread.categoryId, 'Ticket category ID');

    const result = await postgresQuery(`
        insert into discord_bot_ticket_assistant_threads (
            channel_id,
            guild_id,
            category_id,
            status,
            status_reason,
            handed_off_at,
            updated_at
        )
        values ($1, $2, $3, $4, $5, now(), now())
        on conflict (channel_id) do update set
            guild_id = excluded.guild_id,
            category_id = excluded.category_id,
            status = excluded.status,
            status_reason = excluded.status_reason,
            handed_off_at = coalesce(discord_bot_ticket_assistant_threads.handed_off_at, excluded.handed_off_at),
            updated_at = now()
        returning
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
    `, [
        channelId,
        guildId,
        categoryId,
        THREAD_STATUS_HANDED_OFF,
        statusReason ? String(statusReason).slice(0, 240) : null
    ]);

    return mapRowToTicketThread(result.rows[0]);
}

async function markDiscordBotTicketThreadAiResponded(thread) {
    await ensureDiscordBotControlSchema();

    const channelId = normalizeRequiredSnowflake(thread && thread.channelId, 'Ticket channel ID');
    const guildId = normalizeRequiredSnowflake(thread && thread.guildId, 'Ticket guild ID');
    const categoryId = normalizeRequiredSnowflake(thread && thread.categoryId, 'Ticket category ID');

    const result = await postgresQuery(`
        insert into discord_bot_ticket_assistant_threads (
            channel_id,
            guild_id,
            category_id,
            status,
            last_ai_response_at,
            updated_at
        )
        values ($1, $2, $3, $4, now(), now())
        on conflict (channel_id) do update set
            guild_id = excluded.guild_id,
            category_id = excluded.category_id,
            last_ai_response_at = excluded.last_ai_response_at,
            updated_at = now()
        returning
            channel_id,
            guild_id,
            category_id,
            requester_user_id,
            requester_username,
            status,
            status_reason,
            greeted_at,
            handed_off_at,
            last_ai_response_at,
            created_at,
            updated_at
    `, [channelId, guildId, categoryId, THREAD_STATUS_ACTIVE]);

    return mapRowToTicketThread(result.rows[0]);
}

module.exports = {
    THREAD_STATUS_ACTIVE,
    THREAD_STATUS_HANDED_OFF,
    ensureDiscordBotControlSchema,
    getDiscordBotControl,
    updateDiscordBotControl,
    setDiscordBotDesiredEnabled,
    setDiscordBotRuntimeStatus,
    getDiscordBotTicketThread,
    ensureDiscordBotTicketThread,
    markDiscordBotTicketThreadGreeted,
    setDiscordBotTicketThreadRequester,
    markDiscordBotTicketThreadHandedOff,
    markDiscordBotTicketThreadAiResponded
};
