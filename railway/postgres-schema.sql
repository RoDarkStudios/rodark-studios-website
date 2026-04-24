create table if not exists admin_game_config (
    id smallint primary key check (id = 1),
    production_universe_id bigint not null,
    test_universe_id bigint not null,
    development_universe_id bigint not null,
    updated_by_user_id text,
    updated_by_username text,
    updated_at timestamptz not null default now()
);

create table if not exists discord_bot_control (
    id smallint primary key check (id = 1),
    desired_enabled boolean not null default false,
    runtime_status text not null default 'offline',
    last_seen_at timestamptz,
    last_error text,
    ai_ticket_assistant_enabled boolean not null default false,
    ai_ticket_category_id text,
    ai_ticket_owner_role_id text,
    content_rules_channel_id text,
    content_info_channel_id text,
    content_roles_channel_id text,
    content_staff_info_channel_id text,
    content_game_test_info_channel_id text,
    updated_at timestamptz not null default now(),
    updated_by_user_id text,
    updated_by_username text
);

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
);

insert into discord_bot_control (id)
values (1)
on conflict (id) do nothing;
