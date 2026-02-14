# Supabase + Vercel Setup (Passkey Auth)

This repo now includes:
- Passkey auth APIs:
  - `/api/auth/signup` (`action: "options"` then `action: "verify"`)
  - `/api/auth/login` (`action: "options"` then `action: "verify"`)
  - `/api/auth/me`
  - `/api/auth/logout`
- Profile API: `/api/profile`
- Health API: `/api/health`
- SQL schema files:
  - `supabase/001_auth_schema.sql` (existing)
  - `supabase/002_passkey_auth.sql` (new passkey tables)

## What You Must Do

1. Create a Supabase project
- Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
- Click `New project`

2. Apply SQL in Supabase
- In `SQL Editor`, run:
  - `supabase/001_auth_schema.sql`
  - `supabase/002_passkey_auth.sql`

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
