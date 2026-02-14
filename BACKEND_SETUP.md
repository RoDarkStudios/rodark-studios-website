# Supabase + Vercel Setup (Login System)

This repo now includes:
- Auth APIs: `/api/auth/signup`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`
- Profile API: `/api/profile`
- Health API: `/api/health`
- SQL schema + RLS: `supabase/001_auth_schema.sql`

## What You Must Do Yourself

1. Create a Supabase project
- Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
- Click `New project`
- Choose org, region, and set a DB password

2. Apply schema in Supabase
- In Supabase project, open `SQL Editor`
- Run the SQL from `supabase/001_auth_schema.sql`

3. Configure Auth URLs in Supabase
- Open `Authentication` -> `URL Configuration`
- Set `Site URL` to your Vercel domain (example: `https://rodark-studios-website.vercel.app`)
- Add Redirect URLs:
  - `https://rodark-studios-website.vercel.app`
  - `http://localhost:3000` (for local testing)

4. Add env vars in Vercel
- In Vercel project, open `Settings` -> `Environment Variables`
- Add:
  - `SUPABASE_URL` = your Supabase project URL
  - `SUPABASE_ANON_KEY` = your Supabase anon key
- Use scope: `Production`, `Preview`, and `Development`

5. Redeploy
- Trigger a new deploy after env vars are set

## Quick API Test

Use your deployed domain in these examples:

```bash
curl -i -X POST https://YOUR_DOMAIN/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"ChangeMe123!","displayName":"Myron"}'
```

```bash
curl -i -X POST https://YOUR_DOMAIN/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"ChangeMe123!"}'
```

Then call `/api/auth/me` with the returned cookies.

## Notes
- Session tokens are stored in HttpOnly cookies (`rd_access_token`, `rd_refresh_token`).
- Password hashing/storage is handled by Supabase Auth.
- Keep `SUPABASE_ANON_KEY` in env vars and never commit secrets.
