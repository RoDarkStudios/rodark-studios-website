# RoDark Studios Website

Full-stack website and internal admin platform for RoDark Studios.

## Runtime

- Hosting: Railway
- Web runtime: Node.js HTTP server (`server.js`)
- Bot runtime: separate Railway service (`npm run start:bot`)
- Database: Railway Postgres
- Auth: Roblox OAuth 2.0

## Local Development

```bash
npm install
npm start
```

The app listens on `http://localhost:3000` unless `PORT` is set.

To run the Discord bot worker locally:

```bash
npm run start:bot
```

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

Required for the Discord bot worker:

```txt
DISCORD_BOT_TOKEN
DATABASE_URL
OPENAI_API_KEY
GITHUB_TOKEN
```

Optional for the Discord bot worker:

```txt
OPENAI_MODEL
DISCORD_BOT_POLL_INTERVAL_MS
SUPPORT_GAME_REPO_OWNER
SUPPORT_GAME_REPO_NAME
SUPPORT_GAME_REPO_BRANCH
SUPPORT_GAME_REPO_REFRESH_MS
```

## Discord Bot Notes

- Enable the Discord privileged `Message Content Intent` for the bot application, otherwise ticket message content and image context will not be available to the AI assistant.
- The AI ticket assistant is configured from `/admin/discord-bot` and currently supports one monitored ticket category plus one owner role mention target.
- The bot also supports startup channel sync from `/admin/discord-bot`. Configure the fixed channel IDs for `rules`, `info`, `roles`, `staff-info`, and `game-test-info`, then reconnect or restart the bot to resync those channels.
- On startup, the bot ensures required custom emojis exist using local files under `bot/assets/discord/emojis` and uses banner images from `bot/assets/discord/channel-images`.
- The AI ticket assistant can enrich answers from a private GitHub game repo. The current defaults target `RoDarkStudios/build-a-business` on branch `dev`.
- Repo retrieval is intentionally limited to safe client/shared paths (`ReplicatedFirst`, `ReplicatedStorage`, and `StarterPlayerScripts`) and excludes `ServerScriptService`.

## Database

The current schema lives in `railway/postgres-schema.sql`.

## Key Routes

- `/`
- `/privacy`
- `/terms`
- `/admin`
- `/admin/tools`
- `/admin/tools/game-configuration`
- `/admin/discord-bot`
- `/api/health`
