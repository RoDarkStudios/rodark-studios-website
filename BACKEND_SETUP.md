# Supabase + Vercel Setup (Passkey Auth)

This repo now includes:
- Passkey auth APIs:
  - `/api/auth/signup` (`action: "options"` then `action: "verify"`)
  - `/api/auth/login` (`action: "options"` then `action: "verify"`)
  - `/api/auth/me`
  - `/api/auth/logout`
- Profile API: `/api/profile`
- Health API: `/api/health`
- SQL files:
  - `supabase/schema.sql` (single source of truth)
  - `supabase/reset.sql` (destructive pre-launch reset helper)

## What You Must Do

1. Create a Supabase project
- Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
- Click `New project`

2. Apply SQL in Supabase
- In `SQL Editor`, run:
  - `supabase/schema.sql`

## Pre-Launch Workflow (No Migrations)

Since you have not launched yet, use this every time schema changes:
1. Run `supabase/reset.sql` (this wipes auth tables in this repo).
2. Run `supabase/schema.sql`.
3. Redeploy if API behavior changed.

This keeps the repo migration-free while you iterate.

3. Add env vars in Vercel
- In `Settings` -> `Environment Variables`, add:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `AUTH_SECRET` (long random value)
- Optional if you want strict fixed origin/RP config:
  - `AUTH_ORIGIN` (example: `https://rodarkstudios.com`)
  - `AUTH_RP_ID` (example: `rodarkstudios.com`)

4. Redeploy
- Trigger a new deploy after adding env vars

## Passkey Notes
- Passkeys require HTTPS in production.
- On macOS, users can save passkeys in iCloud Keychain and use Touch ID/biometrics to sign in.
- Session is stored in an HttpOnly cookie (`rd_session`).
- Login/signup challenge state is stored in an HttpOnly cookie (`rd_webauthn_state`).
