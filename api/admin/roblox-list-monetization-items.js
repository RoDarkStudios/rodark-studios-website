const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const { parseUniverseId, listAllGamePassConfigs, listAllDeveloperProductConfigs } = require('../_lib/roblox-open-cloud');

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

function parseGameUniverseIds(body) {
    return {
        developmentUniverseId: parseUniverseId(body && body.developmentUniverseId, 'developmentUniverseId'),
        testUniverseId: parseUniverseId(body && body.testUniverseId, 'testUniverseId'),
        productionUniverseId: parseUniverseId(body && body.productionUniverseId, 'productionUniverseId')
    };
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

async function fetchGameSection(label, universeId) {
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

        return {
            label,
            universeId,
            gamePasses,
            developerProducts,
            error: null
        };
    } catch (error) {
        return {
            label,
            universeId,
            gamePasses: [],
            developerProducts: [],
            error: error.message || 'Failed to list monetization items'
        };
    }
}

function formatRows(rows, emptyLabel) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return emptyLabel;
    }

    return rows.map((item) => {
        const name = String(item && item.name ? item.name : '').trim() || '(Unnamed)';
        const id = Number(item && item.id);
        return `${name} - ${Number.isFinite(id) ? id : 'Unknown ID'}`;
    }).join('\n');
}

function buildCombinedTextBlob(games) {
    const list = Array.isArray(games) ? games : [];
    if (list.length === 0) {
        return 'No monetization data returned.';
    }

    return list.map((game) => {
        const label = String(game && game.label ? game.label : 'Game');
        const universeId = Number(game && game.universeId);
        const error = String(game && game.error ? game.error : '').trim();
        const gamePasses = Array.isArray(game && game.gamePasses) ? game.gamePasses : [];
        const developerProducts = Array.isArray(game && game.developerProducts) ? game.developerProducts : [];

        const lines = [
            `${label} (Universe ${Number.isFinite(universeId) ? universeId : 'Unknown'})`,
            'Gamepasses:',
            formatRows(gamePasses, 'No gamepasses found'),
            '',
            'Products:',
            formatRows(developerProducts, 'No products found')
        ];

        if (error) {
            lines.push('', `Error: ${error}`);
        }

        return lines.join('\n');
    }).join('\n\n------------------------------\n\n');
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

        let ids;
        try {
            ids = parseGameUniverseIds(body);
        } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid game universe IDs' });
        }

        const games = await Promise.all([
            fetchGameSection('Production Game', ids.productionUniverseId),
            fetchGameSection('Test Game', ids.testUniverseId),
            fetchGameSection('Development Game', ids.developmentUniverseId)
        ]);

        return sendJson(res, 200, {
            games,
            combinedText: buildCombinedTextBlob(games)
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: error.message || 'Failed to list monetization items'
        });
    }
};
