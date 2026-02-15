# Roblox OAuth 2.0 + Vercel Setup

This repo uses Roblox OAuth 2.0 as the only login method.

## API Endpoints
- `GET /api/auth/login` -> redirects to Roblox authorization
- `GET /api/auth/callback` -> OAuth callback, creates app session cookie
- `GET /api/auth/me` -> returns current signed-in user
- `GET /api/auth/admin` -> resolves Roblox group rank and admin eligibility (`rank >= 254`)
- `POST /api/auth/logout` -> clears session
- `POST /api/admin/roblox-copy-monetization` -> admin sync tool for game passes + developer products
- `GET /api/profile` -> same user profile data from session
- `GET /api/health`

## Required Environment Variables
- `AUTH_SECRET` (long random secret used to sign session/state tokens)
- `ROBLOX_OAUTH_CLIENT_ID`
- `ROBLOX_OAUTH_CLIENT_SECRET`
- `ROBLOX_OPEN_CLOUD_API_KEY` (used by the admin monetization cloning tool)

Optional:
- `ROBLOX_OAUTH_REDIRECT_URI`
  - If not set, app auto-uses `${origin}/api/auth/callback`
- `ROBLOX_OAUTH_SCOPES` (default: `openid profile`)
- `ROBLOX_OAUTH_BASE_URL` (default: `https://apis.roblox.com/oauth`)
- `ROBLOX_GROUP_ID` (default: `5545660`, used for Admin tab visibility)

For `ROBLOX_OPEN_CLOUD_API_KEY`, include these Open Cloud scopes on all source/target universes used by the tool:
- `game-pass:read`
- `game-pass:write`
- `developer-product:read`
- `developer-product:write`

Admin sync behavior notes:
- Target items are matched by name (case-insensitive), then updated to source name/description/icon.
- Missing target items are created.
- Prices for synced/created items are copied from the source universe items.
- Open Cloud currently has no delete endpoints for these resources, so unmatched target items are renamed with `[ARCHIVED] ` and archived (`isForSale=false`) instead of deleted.

## Roblox OAuth App Configuration
In your Roblox OAuth app settings, ensure the redirect URI matches:
- `https://your-domain.com/api/auth/callback` (production)
- `http://localhost:3000/api/auth/callback` (local, if used)

Recommended app links:
- Entry link: `https://your-domain.com/`
- Privacy Policy URL: `https://your-domain.com/privacy`
- Terms of Service URL: `https://your-domain.com/terms`

## Deploy Steps
1. Set environment variables in Vercel.
2. Redeploy.
3. Open your site homepage and click `Sign in with Roblox` in the top-right account badge.

## Notes
- Session is stored in HttpOnly cookie: `rd_session`.
- OAuth state is stored in HttpOnly cookie: `rd_oauth_state`.
