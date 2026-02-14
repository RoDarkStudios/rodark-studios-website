create extension if not exists pgcrypto;

-- Profiles table linked 1:1 with Supabase Auth users
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    username text not null unique,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,30}$')
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, username)
    values (
        new.id,
        coalesce(
            lower(nullif(new.raw_user_meta_data ->> 'username', '')),
            'player_' || substring(replace(new.id::text, '-', '') from 1 for 8)
        )
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Passkey auth tables
create table if not exists public.passkey_users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    username text not null unique,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint passkey_users_email_format check (position('@' in email) > 1),
    constraint passkey_users_username_format check (username ~ '^[a-z0-9_]{3,30}$')
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
