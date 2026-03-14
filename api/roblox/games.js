const { methodNotAllowed, sendJson } = require('../_lib/http');

function parseUniverseIds(rawValue) {
    const values = String(rawValue || '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);

    return Array.from(new Set(values));
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return methodNotAllowed(req, res, ['GET']);
    }

    const universeIds = parseUniverseIds(req.query && req.query.universeIds);
    if (!universeIds.length) {
        return sendJson(res, 400, { error: 'universeIds must include at least one positive integer' });
    }

    try {
        const endpoint = new URL('https://games.roblox.com/v1/games');
        endpoint.searchParams.set('universeIds', universeIds.join(','));

        const robloxResponse = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!robloxResponse.ok) {
            return sendJson(res, 502, {
                error: 'Failed to fetch Roblox games',
                details: `Roblox API returned ${robloxResponse.status}`
            });
        }

        const payload = await robloxResponse.json().catch(() => null);
        const rows = Array.isArray(payload && payload.data) ? payload.data : [];
        const games = rows.map((row) => ({
            universeId: Number(row && row.id),
            rootPlaceId: Number(row && row.rootPlaceId),
            name: typeof (row && row.name) === 'string' ? row.name.trim() : '',
            visits: Number(row && row.visits)
        }));

        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
        return sendJson(res, 200, {
            games
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: 'Failed to load Roblox games',
            details: error.message
        });
    }
};
