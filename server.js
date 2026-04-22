const fs = require('fs');
const http = require('http');
const path = require('path');

const authAdmin = require('./api/auth/admin');
const authCallback = require('./api/auth/callback');
const authLogin = require('./api/auth/login');
const authLogout = require('./api/auth/logout');
const authMe = require('./api/auth/me');
const robloxAvatarHeadshot = require('./api/roblox/avatar-headshot');
const robloxGameIcon = require('./api/roblox/game-icon');
const robloxGames = require('./api/roblox/games');
const robloxGroupStats = require('./api/roblox/group-stats');
const adminCopyMonetization = require('./api/admin/roblox-copy-monetization');
const adminListMonetizationItems = require('./api/admin/roblox-list-monetization-items');
const adminSyncExperienceConfigs = require('./api/admin/roblox-sync-experience-configs');
const adminDiscordBotControl = require('./api/admin/discord-bot-control');

const rootDir = __dirname;
const port = process.env.PORT || 3000;

const pageRoutes = {
    '/privacy': 'privacy.html',
    '/terms': 'terms.html',
    '/admin': 'admin.html',
    '/admin/tools': 'admin-tools.html',
    '/admin/discord-bot': 'admin-discord-bot.html',
    '/admin/tools/copy-monetization': 'admin-copy-monetization.html',
    '/admin/tools/list-monetization-ids': 'admin-list-monetization-ids.html',
    '/admin/tools/sync-game-description': 'admin-sync-game-description.html',
    '/admin/tools/sync-live-configs': 'admin-sync-live-configs.html',
    '/admin/tools/game-configuration': 'admin-game-configuration.html'
};

const htmlRedirects = {
    '/privacy.html': '/privacy',
    '/terms.html': '/terms',
    '/admin.html': '/admin',
    '/admin-tools.html': '/admin/tools',
    '/admin-discord-bot.html': '/admin/discord-bot',
    '/admin-copy-monetization.html': '/admin/tools/copy-monetization',
    '/admin-list-monetization-ids.html': '/admin/tools/list-monetization-ids',
    '/admin-sync-game-description.html': '/admin/tools/sync-game-description',
    '/admin-sync-live-configs.html': '/admin/tools/sync-live-configs',
    '/admin-game-configuration.html': '/admin/tools/game-configuration'
};

const apiRoutes = {
    '/api/auth/admin': authAdmin,
    '/api/auth/callback': authCallback,
    '/api/auth/login': authLogin,
    '/api/auth/logout': authLogout,
    '/api/auth/me': authMe,
    '/api/profile': authMe,
    '/api/roblox/avatar-headshot': robloxAvatarHeadshot,
    '/api/roblox/game-icon': robloxGameIcon,
    '/api/roblox/games': robloxGames,
    '/api/roblox/group-stats': robloxGroupStats,
    '/api/admin/roblox-copy-monetization': adminCopyMonetization,
    '/api/admin/roblox-list-monetization-items': adminListMonetizationItems,
    '/api/admin/roblox-sync-experience-configs': adminSyncExperienceConfigs,
    '/api/admin/discord-bot-control': adminDiscordBotControl
};

const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp'
};

function enhanceResponse(res) {
    res.status = (statusCode) => {
        res.statusCode = statusCode;
        return res;
    };

    res.json = (data) => {
        if (!res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify(data));
    };

    return res;
}

function sendJson(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
}

function sendRedirect(res, statusCode, location) {
    res.statusCode = statusCode;
    res.setHeader('Location', location);
    res.end();
}

function resolveStaticPath(urlPath) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(urlPath);
    } catch (error) {
        return null;
    }

    const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(rootDir, normalizedPath);

    if (!filePath.startsWith(rootDir)) {
        return null;
    }

    return filePath;
}

function sendFile(res, filename) {
    const filePath = path.isAbsolute(filename) ? filename : path.join(rootDir, filename);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            sendJson(res, 404, { error: 'Not Found' });
            return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        fs.createReadStream(filePath).pipe(res);
    });
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    if (!chunks.length) {
        return undefined;
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    if (!rawBody.trim()) {
        return {};
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
        return JSON.parse(rawBody);
    }

    return rawBody;
}

async function handleApi(req, res, pathname) {
    const handler = apiRoutes[pathname];
    if (!handler) {
        sendJson(res, 404, { error: 'Not Found' });
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.body = await readBody(req);
    }

    await handler(req, res);
}

async function handleRequest(req, res) {
    enhanceResponse(res);

    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    const routePath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    req.query = Object.fromEntries(requestUrl.searchParams.entries());

    if (routePath === '/health' || routePath === '/api/health') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (htmlRedirects[routePath]) {
        sendRedirect(res, 301, `${htmlRedirects[routePath]}${requestUrl.search}`);
        return;
    }

    if (routePath !== pathname && (pageRoutes[routePath] || apiRoutes[routePath])) {
        sendRedirect(res, 301, `${routePath}${requestUrl.search}`);
        return;
    }

    if (pageRoutes[routePath]) {
        sendFile(res, pageRoutes[routePath]);
        return;
    }

    if (routePath.startsWith('/api/')) {
        await handleApi(req, res, routePath);
        return;
    }

    const staticPath = resolveStaticPath(pathname === '/' ? '/index.html' : pathname);
    if (staticPath && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
        sendFile(res, staticPath);
        return;
    }

    sendFile(res, 'index.html');
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
        console.error(error);
        if (res.headersSent) {
            res.end();
            return;
        }

        sendJson(res, 500, {
            error: 'Internal Server Error',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    });
});

server.listen(port, () => {
    console.log(`RoDark Studios platform listening on port ${port}`);
});
