const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const { parseUniverseId, listAllGamePassConfigs, listAllDeveloperProductConfigs } = require('../_lib/roblox-open-cloud');

const MAX_UNIVERSES_PER_REQUEST = 50;

async function requireAdmin(req, res) {
    const groupId = getAdminGroupId();
    const { user } = await requireUserFromSession(req, res);
    if (!user) {
        return { user: null, isAdmin: false };
    }

    const roleEntry = await fetchUserGroupRole(user.id, groupId);
    const rank = getRoleRank(roleEntry);
    return {
        user,
        isAdmin: rank !== null && rank >= 254
    };
}

function parseUniverseIds(rawUniverseIds) {
    const values = Array.isArray(rawUniverseIds) ? rawUniverseIds : [];
    const ids = [];
    const seen = new Set();

    for (const value of values) {
        const id = parseUniverseId(value, 'universeIds[]');
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        ids.push(id);
    }

    if (ids.length === 0) {
        throw new Error('At least one universe ID is required');
    }

    if (ids.length > MAX_UNIVERSES_PER_REQUEST) {
        throw new Error(`A maximum of ${MAX_UNIVERSES_PER_REQUEST} universe IDs is allowed per request`);
    }

    return ids;
}

function toGamePassRow(config) {
    const id = Number(config && config.gamePassId);
    if (!Number.isFinite(id)) {
        return null;
    }

    return {
        id,
        name: String(config && config.name ? config.name : '').trim() || '(Unnamed Game Pass)'
    };
}

function toDeveloperProductRow(config) {
    const id = Number(config && config.productId);
    if (!Number.isFinite(id)) {
        return null;
    }

    return {
        id,
        name: String(config && config.name ? config.name : '').trim() || '(Unnamed Developer Product)'
    };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return methodNotAllowed(req, res, ['POST']);
    }

    try {
        const auth = await requireAdmin(req, res);
        if (!auth.user) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }
        if (!auth.isAdmin) {
            return sendJson(res, 403, { error: 'Admin access required' });
        }

        const body = await readJsonBody(req);

        let universeIds;
        try {
            universeIds = parseUniverseIds(body && body.universeIds);
        } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid universe IDs' });
        }

        const universes = [];
        const failures = [];
        let totalGamePasses = 0;
        let totalDeveloperProducts = 0;

        for (const universeId of universeIds) {
            try {
                const [gamePassConfigs, developerProductConfigs] = await Promise.all([
                    listAllGamePassConfigs(universeId),
                    listAllDeveloperProductConfigs(universeId)
                ]);

                const gamePasses = gamePassConfigs
                    .map(toGamePassRow)
                    .filter(Boolean)
                    .sort((a, b) => a.id - b.id);

                const developerProducts = developerProductConfigs
                    .map(toDeveloperProductRow)
                    .filter(Boolean)
                    .sort((a, b) => a.id - b.id);

                totalGamePasses += gamePasses.length;
                totalDeveloperProducts += developerProducts.length;

                universes.push({
                    universeId,
                    gamePasses,
                    developerProducts
                });
            } catch (error) {
                failures.push({
                    universeId,
                    error: error.message || 'Failed to list monetization items'
                });
            }
        }

        return sendJson(res, 200, {
            requestedUniverseIds: universeIds,
            totals: {
                universesRequested: universeIds.length,
                universesProcessed: universes.length,
                universesFailed: failures.length,
                totalGamePasses,
                totalDeveloperProducts
            },
            limitations: [
                'Roblox APIs do not provide a single global endpoint for every game pass and developer product across all of Roblox.',
                'This tool lists all game passes and developer products for the universe IDs you provide (limited to what your API key can access).'
            ],
            universes,
            failures
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: error.message || 'Failed to list monetization items'
        });
    }
};
