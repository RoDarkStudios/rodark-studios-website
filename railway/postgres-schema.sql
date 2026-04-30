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
    guild_id text,
    content_rules_channel_id text,
    content_info_channel_id text,
    content_roles_channel_id text,
    content_staff_info_channel_id text,
    content_game_test_info_channel_id text,
    tickets_category_channel_id text,
    tickets_panel_channel_id text,
    tickets_panel_message_id text,
    tickets_helper_role_ids text[] not null default '{}',
    updated_at timestamptz not null default now(),
    updated_by_user_id text,
    updated_by_username text
);

insert into discord_bot_control (id)
values (1)
on conflict (id) do nothing;

create sequence if not exists discord_bot_ticket_id_seq
    as bigint
    start with 1
    increment by 1
    no minvalue
    no maxvalue
    cache 1;

create table if not exists discord_bot_tickets (
    ticket_id bigint primary key,
    guild_id text not null,
    channel_id text unique,
    opener_user_id text not null,
    status text not null default 'open',
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    closed_by_user_id text
);
