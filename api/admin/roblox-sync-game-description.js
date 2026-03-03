const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const {
    parseUniverseId,
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
    const productionUniverseId = parseUniverseId(body && body.productionUniverseId, 'productionUniverseId');
    const testUniverseId = parseUniverseId(body && body.testUniverseId, 'testUniverseId');
    const developmentUniverseId = parseUniverseId(body && body.developmentUniverseId, 'developmentUniverseId');

    if (
        productionUniverseId === testUniverseId
        || productionUniverseId === developmentUniverseId
        || testUniverseId === developmentUniverseId
    ) {
        throw new Error('Production, Test, and Development universe IDs must be different');
    }

    return {
        productionUniverseId,
        testUniverseId,
        developmentUniverseId
    };
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
            const payload = await loadProductionDescription(body);
            return sendJson(res, 200, payload);
        }

        if (operation === 'save') {
            const payload = await saveDescriptions(body);
            return sendJson(res, 200, payload);
        }

        return sendJson(res, 400, {
            error: 'Invalid operation. Use "load" or "save".'
        });
    } catch (error) {
        const failures = Array.isArray(error && error.failures) ? error.failures : null;
        const successes = Array.isArray(error && error.successes) ? error.successes : null;

        return sendJson(res, 500, {
            error: error.message || 'Failed to sync game descriptions',
            failures,
            successes
        });
    }
};
