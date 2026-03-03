const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const {
    parseUniverseId,
    listAllGamePassConfigs,
    listAllDeveloperProductConfigs,
    getUniverseDescription,
    updateUniverseDescription
} = require('../_lib/roblox-open-cloud');

const TEST_PREFIX = '\u26A0\uFE0F THIS IS THE TEST GAME - THIS IS NOT THE OFFICIAL GAME';
const DEVELOPMENT_PREFIX = '\u26A0\uFE0F THIS IS THE DEVELOPMENT GAME - THIS IS NOT THE OFFICIAL GAME';
const ENVIRONMENT_PREFIX_REGEX = /^\u26A0(?:\uFE0F)? THIS IS THE (TEST|DEVELOPMENT) GAME - THIS IS NOT THE OFFICIAL GAME(?:\r?\n|\r)?(?:\r?\n|\r)?/i;

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

function validateDistinctUniverseIds(ids) {
    if (
        ids.productionUniverseId === ids.testUniverseId
        || ids.productionUniverseId === ids.developmentUniverseId
        || ids.testUniverseId === ids.developmentUniverseId
    ) {
        throw new Error('Production, Test, and Development universe IDs must be different');
    }
}

function normalizeDescriptionInput(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function stripEnvironmentPrefix(description) {
    let cleaned = normalizeDescriptionInput(description);

    while (ENVIRONMENT_PREFIX_REGEX.test(cleaned)) {
        cleaned = cleaned.replace(ENVIRONMENT_PREFIX_REGEX, '').trimStart();
    }

    return cleaned;
}

function prefixDescription(prefix, description) {
    const base = stripEnvironmentPrefix(description);
    if (!base) {
        return prefix;
    }

    return `${prefix}\n\n${base}`;
}

async function loadProductionDescription(body) {
    const productionUniverseId = parseUniverseId(body && body.productionUniverseId, 'productionUniverseId');
    const productionData = await getUniverseDescription(productionUniverseId);

    return {
        productionUniverseId,
        productionRootPlaceId: productionData.placeId,
        productionDescription: productionData.description || ''
    };
}

async function saveDescriptions(body) {
    const ids = parseGameUniverseIds(body);
    validateDistinctUniverseIds(ids);

    const editedDescription = normalizeDescriptionInput(body && body.description);
    const productionDescription = stripEnvironmentPrefix(editedDescription);
    const testDescription = prefixDescription(TEST_PREFIX, productionDescription);
    const developmentDescription = prefixDescription(DEVELOPMENT_PREFIX, productionDescription);

    const updates = [
        {
            label: 'Production',
            universeId: ids.productionUniverseId,
            description: productionDescription
        },
        {
            label: 'Test',
            universeId: ids.testUniverseId,
            description: testDescription
        },
        {
            label: 'Development',
            universeId: ids.developmentUniverseId,
            description: developmentDescription
        }
    ];

    const settled = await Promise.allSettled(updates.map(async (item) => {
        const updateInfo = await updateUniverseDescription(item.universeId, item.description);
        return {
            label: item.label,
            universeId: item.universeId,
            placeId: updateInfo.placeId,
            descriptionLength: item.description.length
        };
    }));

    const successes = [];
    const failures = [];

    settled.forEach((entry, index) => {
        const target = updates[index];
        if (entry.status === 'fulfilled') {
            successes.push(entry.value);
            return;
        }

        failures.push({
            label: target.label,
            universeId: target.universeId,
            error: entry.reason && entry.reason.message
                ? String(entry.reason.message)
                : 'Unknown error'
        });
    });

    if (failures.length > 0) {
        const summary = failures.map((item) => `${item.label} (${item.universeId}): ${item.error}`).join(' | ');
        const error = new Error(`Failed to update all games: ${summary}`);
        error.failures = failures;
        error.successes = successes;
        throw error;
    }

    return {
        productionDescription,
        testDescription,
        developmentDescription,
        updates: successes
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

        const operation = String(body && body.operation ? body.operation : '').trim().toLowerCase();
        if (operation === 'load') {
            try {
                const payload = await loadProductionDescription(body);
                return sendJson(res, 200, payload);
            } catch (error) {
                return sendJson(res, 400, {
                    error: error.message || 'Invalid production universe ID'
                });
            }
        }

        if (operation === 'save') {
            try {
                const payload = await saveDescriptions(body);
                return sendJson(res, 200, payload);
            } catch (error) {
                const failures = Array.isArray(error && error.failures) ? error.failures : null;
                const successes = Array.isArray(error && error.successes) ? error.successes : null;
                return sendJson(res, 500, {
                    error: error.message || 'Failed to sync game descriptions',
                    failures,
                    successes
                });
            }
        }

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
