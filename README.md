# RoDark Studios Website

Full-stack website and internal admin platform for RoDark Studios.

## Runtime

- Hosting: Railway
- Web runtime: Node.js HTTP server (`server.js`)
- Database: Railway Postgres
- Auth: Roblox OAuth 2.0

## Local Development

```bash
npm install
npm start
```

The app listens on `http://localhost:3000` unless `PORT` is set.

## Required Environment Variables

```txt
AUTH_SECRET
ROBLOX_OAUTH_CLIENT_ID
ROBLOX_OAUTH_CLIENT_SECRET
ROBLOX_OPEN_CLOUD_API_KEY
DATABASE_URL
```

Optional:

```txt
ROBLOX_GROUP_ID
ROBLOX_OAUTH_REDIRECT_URI
ROBLOX_OAUTH_SCOPES
ROBLOX_OAUTH_BASE_URL
```

## Database

The current schema lives in `railway/postgres-schema.sql`.

## Key Routes

- `/`
- `/privacy`
- `/terms`
- `/admin`
- `/admin/tools`
- `/admin/tools/game-configuration`
- `/api/health`
