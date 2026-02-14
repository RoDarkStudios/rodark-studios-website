-- Pre-launch reset script (destructive). Run this before schema.sql when you change DB structure.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.passkey_credentials cascade;
drop table if exists public.passkey_users cascade;
drop table if exists public.profiles cascade;
