create extension if not exists pgcrypto;

create table if not exists public.passkey_users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    display_name text not null default 'Player',
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint passkey_users_email_format check (position('@' in email) > 1),
    constraint passkey_users_display_name_length check (char_length(display_name) between 1 and 50)
);

create table if not exists public.passkey_credentials (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.passkey_users(id) on delete cascade,
    credential_id text not null unique,
    public_key_jwk jsonb not null,
    sign_count bigint not null default 0,
    transports text[] not null default '{}',
    created_at timestamptz not null default timezone('utc', now()),
    last_used_at timestamptz
);

create index if not exists idx_passkey_credentials_user_id on public.passkey_credentials(user_id);

alter table public.passkey_users enable row level security;
alter table public.passkey_credentials enable row level security;
