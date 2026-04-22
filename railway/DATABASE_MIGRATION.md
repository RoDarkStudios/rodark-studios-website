# Railway Postgres Migration

The app prefers Railway Postgres when `DATABASE_URL` is present. If Postgres has no `admin_game_config` row yet, it falls back to Supabase as long as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain set.

## Schema

Run `railway/postgres-schema.sql` against Railway Postgres if you want to create the table manually.

## One-Time Supabase Copy

With these variables available:

```txt
DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

run:

```bash
npm run db:migrate:supabase-to-postgres
```

After confirming `/admin/tools/game-configuration` loads and saves correctly through Railway Postgres, remove `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Railway.
