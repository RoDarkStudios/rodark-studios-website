const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const {
    parseUniverseId,
    listAllGamePassConfigs,
    listAllDeveloperProductConfigs,
    listAllBadges,
    getGamePassThumbnailUrlMap,
    getDeveloperProductThumbnailUrlMap,
    getBadgeThumbnailUrlMap,
    getAssetThumbnailUrlMap,
    downloadImageBuffer,
    createGamePass,
    updateGamePass,
    createDeveloperProduct,
    updateDeveloperProduct,
    createBadge,
    updateBadge,
    updateBadgeIcon,
    sleep
} = require('../_lib/roblox-open-cloud');
const { tryAcquireMonetizationLock, releaseMonetizationLock } = require('../_lib/monetization-sync-lock');
const { getStoredGameConfig } = require('../_lib/admin-game-config-store');

const ARCHIVED_NAME_PREFIX = '[ARCHIVED] ';
const LEGACY_ARCHIVED_MONETIZATION_NAME = 'Archived';
const LEGACY_ARCHIVED_MONETIZATION_NAME_KEY = LEGACY_ARCHIVED_MONETIZATION_NAME.toLowerCase();
const ARCHIVED_ICON_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAaQAAAGkCAYAAAB+TFE1AAAE3ElEQVR42u3VoQEAAAjDsMn9/zCcgSAiD9Q0bQcArkUEAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJBEAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJBEAMCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQxICAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQxIBAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMSQQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkADAkAAwJAAwJAEMCAEMCwJAAwJAAMCQAMCQADAkADAkAQwIAQwLAkADAkAAwJAAwJAAMCQAMCQBDAgBDAsCQAMCQADAkADAkAAwJAAwJAEMCAEMCwJAAwJAA+G4BgEMkcl3kgj0AAAAASUVORK5CYII=',
    'base64'
);
const FORCED_TARGET_PRICE = 1;
const MISSING_CONFIG_MESSAGE = 'Game IDs are not configured. Open Admin > Game Configuration and save Production/Test/Development IDs.';
const COPY_SLEEP_SOURCE_GAME_PASS_MS = 250;
const COPY_SLEEP_ARCHIVE_GAME_PASS_MS = 150;
const COPY_SLEEP_SOURCE_DEVELOPER_PRODUCT_MS = 400;
const COPY_SLEEP_ARCHIVE_DEVELOPER_PRODUCT_MS = 250;
const COPY_SLEEP_SOURCE_BADGE_MS = 300;
const COPY_SLEEP_ARCHIVE_BADGE_MS = 150;
const ESTIMATE_PER_OPERATION_MIN_OVERHEAD_MS = 120;
const ESTIMATE_PER_OPERATION_MAX_OVERHEAD_MS = 320;
const ESTIMATE_FIXED_MIN_OVERHEAD_MS = 3000;
const ESTIMATE_FIXED_MAX_OVERHEAD_MS = 8000;

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

async function hydrateItemsWithImages(configs, idFieldName, thumbnailUrlMap, kindLabel, fallbackOptions) {
    const hydrated = [];

    for (const config of configs) {
        const sourceId = Number(config && config[idFieldName]);
        if (!Number.isFinite(sourceId)) {
            continue;
        }

        let thumbnailUrl = thumbnailUrlMap.get(sourceId) || null;
        if (!thumbnailUrl && fallbackOptions && fallbackOptions.assetIdField && fallbackOptions.assetThumbnailMap) {
            const assetId = Number(config && config[fallbackOptions.assetIdField]);
            if (Number.isFinite(assetId)) {
                thumbnailUrl = fallbackOptions.assetThumbnailMap.get(assetId) || null;
            }
        }

        let imageBuffer = null;
        let imageWarning = null;

        if (!thumbnailUrl) {
            imageWarning = `${kindLabel} thumbnail URL was not available`;
        } else {
            try {
                imageBuffer = await downloadImageBuffer(thumbnailUrl);
            } catch (error) {
                imageWarning = error.message || 'Failed to download icon image';
            }
        }

        hydrated.push({
            sourceId,
            config,
            imageBuffer,
            imageWarning
        });
    }

    return hydrated;
}

function buildResultBucket() {
    return {
        attempted: 0,
        created: 0,
        updated: 0,
        archived: 0,
        failed: [],
        warnings: [],
        createdItems: [],
        updatedItems: [],
        archivedItems: []
    };
}

function normalizeNameKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isArchivedMonetizationConfig(config, resolvedName) {
    const name = String(resolvedName || (config && config.name) || '').trim();
    const nameKey = normalizeNameKey(name);
    const legacyArchivedPrefixKey = normalizeNameKey(ARCHIVED_NAME_PREFIX);
    return nameKey === LEGACY_ARCHIVED_MONETIZATION_NAME_KEY || nameKey.startsWith(legacyArchivedPrefixKey);
}

function buildTargetNameIndex(configs, idFieldName, options) {
    const allEntries = [];
    const byName = new Map();
    const archivedEntries = [];
    const settings = options || {};
    const includeArchivedPool = settings.includeArchivedPool === true;

    for (const config of configs) {
        const id = Number(config && config[idFieldName]);
        if (!Number.isFinite(id)) {
            continue;
        }

        const name = String(config && config.name ? config.name : '').trim();
        const nameKey = normalizeNameKey(name);
        const entry = {
            id,
            name,
            nameKey,
            config
        };

        allEntries.push(entry);

        if (includeArchivedPool && isArchivedMonetizationConfig(config, name)) {
            archivedEntries.push(entry);
        }

        if (!nameKey) {
            continue;
        }

        if (!byName.has(nameKey)) {
            byName.set(nameKey, []);
        }
        byName.get(nameKey).push(entry);
    }

    return {
        allEntries,
        byName,
        archivedEntries
    };
}

function consumeMatchByName(byName, nameKey, consumedIds) {
    if (!nameKey) {
        return null;
    }

    const bucket = byName.get(nameKey);
    if (!bucket || bucket.length === 0) {
        return null;
    }

    while (bucket.length > 0) {
        const entry = bucket.shift();
        if (!entry || consumedIds.has(entry.id)) {
            continue;
        }
        return entry;
    }

    return null;
}

function consumeArchivedEntry(archivedEntries, consumedIds) {
    const pool = Array.isArray(archivedEntries) ? archivedEntries : [];

    while (pool.length > 0) {
        const entry = pool.shift();
        if (!entry || consumedIds.has(entry.id)) {
            continue;
        }
        return entry;
    }

    return null;
}

function isImageUploadError(error) {
    const message = String(error && error.message ? error.message : '').toLowerCase();
    return (
        message.includes('image')
        || message.includes('icon')
        || message.includes('malformed')
        || message.includes('format')
        || message.includes('process image')
        || message.includes('invalid')
        || message.includes('file')
    );
}

function isDuplicateNameError(error) {
    const message = String(error && error.message ? error.message : '').toLowerCase();
    return (
        message.includes('duplicateproductname')
        || message.includes('name already exists')
        || message.includes('already exists in the universe')
    );
}

function buildArchiveNameCandidates(targetId) {
    const numericId = Number(targetId);
    const suffix = Number.isFinite(numericId) && numericId > 0
        ? String(Math.round(numericId))
        : 'unknown';
    return [`${ARCHIVED_NAME_PREFIX}${suffix}`];
}

async function archiveMonetizationItemWithNameFallback(
    targetId,
    updateAttempt,
    warnings,
    warningPayload
) {
    const nameCandidates = buildArchiveNameCandidates(targetId);
    let lastError = null;

    for (let index = 0; index < nameCandidates.length; index += 1) {
        const nameOverride = nameCandidates[index];

        try {
            try {
                await updateAttempt(nameOverride, ARCHIVED_ICON_BUFFER);
                return;
            } catch (error) {
                if (isDuplicateNameError(error) && index < nameCandidates.length - 1) {
                    continue;
                }
                if (!isImageUploadError(error)) {
                    throw error;
                }

                try {
                    await updateAttempt(nameOverride, null);
                    warnings.push({
                        ...warningPayload,
                        warning: 'Archived without replacing icon because Roblox rejected neutral icon upload'
                    });
                    return;
                } catch (fallbackError) {
                    if (isDuplicateNameError(fallbackError) && index < nameCandidates.length - 1) {
                        continue;
                    }
                    throw fallbackError;
                }
            }
        } catch (error) {
            lastError = error;
            if (isDuplicateNameError(error) && index < nameCandidates.length - 1) {
                continue;
            }
            break;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('Failed to archive item');
}

function parseGameUniverseIdsFromBody(body) {
    return {
        productionUniverseId: parseUniverseId(body && body.productionUniverseId, 'productionUniverseId'),
        testUniverseId: parseUniverseId(body && body.testUniverseId, 'testUniverseId'),
        developmentUniverseId: parseUniverseId(body && body.developmentUniverseId, 'developmentUniverseId')
    };
}

function validateDistinctUniverseIds(ids) {
    if (
        ids.productionUniverseId === ids.developmentUniverseId
        || ids.productionUniverseId === ids.testUniverseId
        || ids.developmentUniverseId === ids.testUniverseId
    ) {
        throw new Error('Production, Test, and Development universe IDs must be different');
    }
}

function hasUniverseIdValue(value) {
    return String(value || '').trim().length > 0;
}

function hasAnyUniverseIdFields(body) {
    return (
        hasUniverseIdValue(body && body.productionUniverseId)
        || hasUniverseIdValue(body && body.testUniverseId)
        || hasUniverseIdValue(body && body.developmentUniverseId)
    );
}

function hasAllUniverseIdFields(body) {
    return (
        hasUniverseIdValue(body && body.productionUniverseId)
        && hasUniverseIdValue(body && body.testUniverseId)
        && hasUniverseIdValue(body && body.developmentUniverseId)
    );
}

async function resolveGameUniverseIds(body) {
    if (hasAnyUniverseIdFields(body)) {
        if (!hasAllUniverseIdFields(body)) {
            throw new Error('Provide all three IDs or none. Leave all blank to use saved Game Configuration.');
        }

        const ids = parseGameUniverseIdsFromBody(body);
        validateDistinctUniverseIds(ids);
        return ids;
    }

    const storedConfig = await getStoredGameConfig();
    if (!storedConfig) {
        throw new Error(MISSING_CONFIG_MESSAGE);
    }

    const ids = {
        productionUniverseId: Number(storedConfig.productionUniverseId),
        testUniverseId: Number(storedConfig.testUniverseId),
        developmentUniverseId: Number(storedConfig.developmentUniverseId)
    };
    validateDistinctUniverseIds(ids);
    return ids;
}

function parseOperation(body) {
    const value = String(body && body.operation ? body.operation : 'copy').trim().toLowerCase();
    if (!value || value === 'copy' || value === 'estimate') {
        return value || 'copy';
    }

    throw new Error('Invalid operation. Supported values: copy, estimate.');
}

function toNonNegativeCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return 0;
    }

    return Math.max(0, Math.round(numeric));
}

function buildCopyDurationEstimate(sourceCounts, targetCounts) {
    const source = {
        gamePasses: toNonNegativeCount(sourceCounts && sourceCounts.gamePasses),
        developerProducts: toNonNegativeCount(sourceCounts && sourceCounts.developerProducts),
        badges: toNonNegativeCount(sourceCounts && sourceCounts.badges)
    };
    const targets = Array.isArray(targetCounts) ? targetCounts : [];

    let sleepBudgetMs = 0;
    let operationCount = 0;

    for (const target of targets) {
        const targetGamePasses = toNonNegativeCount(target && target.gamePasses);
        const targetDeveloperProducts = toNonNegativeCount(target && target.developerProducts);
        const targetBadges = toNonNegativeCount(target && target.badges);

        operationCount += (
            source.gamePasses
            + source.developerProducts
            + source.badges
            + targetGamePasses
            + targetDeveloperProducts
            + targetBadges
        );

        sleepBudgetMs += (
            (source.gamePasses * COPY_SLEEP_SOURCE_GAME_PASS_MS)
            + (targetGamePasses * COPY_SLEEP_ARCHIVE_GAME_PASS_MS)
            + (source.developerProducts * COPY_SLEEP_SOURCE_DEVELOPER_PRODUCT_MS)
            + (targetDeveloperProducts * COPY_SLEEP_ARCHIVE_DEVELOPER_PRODUCT_MS)
            + (source.badges * COPY_SLEEP_SOURCE_BADGE_MS)
            + (targetBadges * COPY_SLEEP_ARCHIVE_BADGE_MS)
        );
    }

    const minimumDurationMs = sleepBudgetMs + (operationCount * ESTIMATE_PER_OPERATION_MIN_OVERHEAD_MS) + ESTIMATE_FIXED_MIN_OVERHEAD_MS;
    const conservativeDurationMs = sleepBudgetMs + (operationCount * ESTIMATE_PER_OPERATION_MAX_OVERHEAD_MS) + ESTIMATE_FIXED_MAX_OVERHEAD_MS;
    const estimatedDurationMs = Math.round((minimumDurationMs + conservativeDurationMs) / 2);

    return {
        sleepBudgetMs,
        operationCount,
        minimumDurationMs,
        estimatedDurationMs,
        conservativeDurationMs
    };
}

async function buildCopyEstimatePayload(ids) {
    const sourceUniverseId = ids.productionUniverseId;
    const targetUniverseIds = [ids.testUniverseId, ids.developmentUniverseId];

    const [sourceGamePasses, sourceDeveloperProducts, sourceBadges] = await Promise.all([
        listAllGamePassConfigs(sourceUniverseId),
        listAllDeveloperProductConfigs(sourceUniverseId),
        listAllBadges(sourceUniverseId)
    ]);

    const targetSummaries = await Promise.all(targetUniverseIds.map(async (targetUniverseId) => {
        const [targetGamePasses, targetDeveloperProducts, targetBadges] = await Promise.all([
            listAllGamePassConfigs(targetUniverseId),
            listAllDeveloperProductConfigs(targetUniverseId),
            listAllBadges(targetUniverseId)
        ]);

        return {
            targetUniverseId,
            gamePasses: targetGamePasses.length,
            developerProducts: targetDeveloperProducts.length,
            badges: targetBadges.length
        };
    }));

    const sourceCounts = {
        gamePasses: sourceGamePasses.length,
        developerProducts: sourceDeveloperProducts.length,
        badges: sourceBadges.length
    };
    const estimate = buildCopyDurationEstimate(
        sourceCounts,
        targetSummaries.map((item) => ({
            gamePasses: item.gamePasses,
            developerProducts: item.developerProducts,
            badges: item.badges
        }))
    );

    return {
        operation: 'estimate',
        sourceUniverseId,
        targetUniverseIds,
        sourceCounts,
        targetCounts: targetSummaries,
        ...estimate
    };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return methodNotAllowed(req, res, ['POST']);
    }

    let lockOwnerId = null;

    try {
        const auth = await requireAdmin(req, res);
        if (!auth.user) {
            return sendJson(res, 401, { error: 'Not authenticated' });
        }
        if (!auth.isAdmin) {
            return sendJson(res, 403, { error: 'Admin access required' });
        }

        const body = await readJsonBody(req);
        let operation;
        try {
            operation = parseOperation(body);
        } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid operation' });
        }

        let ids;
        try {
            ids = await resolveGameUniverseIds(body);
        } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid request body' });
        }

        if (operation === 'estimate') {
            const estimatePayload = await buildCopyEstimatePayload(ids);
            return sendJson(res, 200, estimatePayload);
        }

        const sourceUniverseId = ids.productionUniverseId;
        const developmentUniverseId = ids.developmentUniverseId;
        const testUniverseId = ids.testUniverseId;
        const targetUniverseIds = [testUniverseId, developmentUniverseId];
        const pricingOverrideOptions = { fixedPrice: FORCED_TARGET_PRICE };

        const lockAttempt = tryAcquireMonetizationLock(
            [sourceUniverseId, ...targetUniverseIds],
            auth.user && auth.user.username ? auth.user.username : auth.user.id
        );
        if (!lockAttempt.acquired) {
            return sendJson(res, 409, {
                error: 'Another admin is currently using this tool. Try again later.',
                conflicts: lockAttempt.conflicts
            });
        }
        lockOwnerId = lockAttempt.ownerId;

        const sourceGamePasses = await listAllGamePassConfigs(sourceUniverseId);
        const sourceDeveloperProducts = await listAllDeveloperProductConfigs(sourceUniverseId);
        const sourceBadges = await listAllBadges(sourceUniverseId);

        const gamePassThumbnailMap = await getGamePassThumbnailUrlMap(
            sourceGamePasses.map((item) => Number(item && item.gamePassId)).filter((id) => Number.isFinite(id))
        );
        const developerProductThumbnailMap = await getDeveloperProductThumbnailUrlMap(
            sourceDeveloperProducts.map((item) => Number(item && item.productId)).filter((id) => Number.isFinite(id))
        );
        const badgeThumbnailMap = await getBadgeThumbnailUrlMap(
            sourceBadges.map((item) => Number(item && item.id)).filter((id) => Number.isFinite(id))
        );
        const gamePassAssetThumbnailMap = await getAssetThumbnailUrlMap(
            sourceGamePasses.map((item) => Number(item && item.iconAssetId)).filter((id) => Number.isFinite(id)),
            '150x150'
        );
        const developerProductAssetThumbnailMap = await getAssetThumbnailUrlMap(
            sourceDeveloperProducts.map((item) => Number(item && item.iconImageAssetId)).filter((id) => Number.isFinite(id)),
            '420x420'
        );

        const preparedGamePasses = await hydrateItemsWithImages(
            sourceGamePasses,
            'gamePassId',
            gamePassThumbnailMap,
            'Game pass',
            {
                assetIdField: 'iconAssetId',
                assetThumbnailMap: gamePassAssetThumbnailMap
            }
        );
        const preparedDeveloperProducts = await hydrateItemsWithImages(
            sourceDeveloperProducts,
            'productId',
            developerProductThumbnailMap,
            'Developer product',
            {
                assetIdField: 'iconImageAssetId',
                assetThumbnailMap: developerProductAssetThumbnailMap
            }
        );
        const preparedBadges = await hydrateItemsWithImages(
            sourceBadges,
            'id',
            badgeThumbnailMap,
            'Badge'
        );

        const targets = [];

        for (const targetUniverseId of targetUniverseIds) {
            const gamePasses = buildResultBucket();
            const developerProducts = buildResultBucket();
            const badges = buildResultBucket();

            const existingTargetGamePasses = await listAllGamePassConfigs(targetUniverseId);
            const existingTargetDeveloperProducts = await listAllDeveloperProductConfigs(targetUniverseId);
            const existingTargetBadges = await listAllBadges(targetUniverseId);
            const indexedTargetGamePasses = buildTargetNameIndex(existingTargetGamePasses, 'gamePassId', {
                includeArchivedPool: true
            });
            const indexedTargetDeveloperProducts = buildTargetNameIndex(existingTargetDeveloperProducts, 'productId', {
                includeArchivedPool: true
            });
            const indexedTargetBadges = buildTargetNameIndex(existingTargetBadges, 'id');
            const matchedTargetGamePassIds = new Set();
            const matchedTargetDeveloperProductIds = new Set();
            const matchedTargetBadgeIds = new Set();

            for (const sourcePass of preparedGamePasses) {
                gamePasses.attempted += 1;
                const sourceName = String(sourcePass && sourcePass.config && sourcePass.config.name ? sourcePass.config.name : '').trim();
                const sourceNameKey = normalizeNameKey(sourceName);
                const iconWarning = sourcePass.imageWarning
                    ? `${sourcePass.imageWarning}. Synced without icon.`
                    : null;

                const matchedTargetPassByName = consumeMatchByName(
                    indexedTargetGamePasses.byName,
                    sourceNameKey,
                    matchedTargetGamePassIds
                );
                const matchedArchivedPass = matchedTargetPassByName
                    ? null
                    : consumeArchivedEntry(indexedTargetGamePasses.archivedEntries, matchedTargetGamePassIds);
                const matchedTargetPass = matchedTargetPassByName || matchedArchivedPass;

                try {
                    if (matchedTargetPass) {
                        await updateGamePass(targetUniverseId, matchedTargetPass.id, sourcePass.config, sourcePass.imageBuffer, {
                            ...pricingOverrideOptions,
                            forceForSale: true
                        });
                        matchedTargetGamePassIds.add(matchedTargetPass.id);
                        gamePasses.updated += 1;
                        gamePasses.updatedItems.push({
                            sourceId: sourcePass.sourceId,
                            targetId: matchedTargetPass.id,
                            name: sourceName,
                            recycledFromArchive: Boolean(matchedArchivedPass)
                        });
                        if (iconWarning) {
                            gamePasses.warnings.push({
                                sourceId: sourcePass.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    } else {
                        const created = await createGamePass(targetUniverseId, sourcePass.config, sourcePass.imageBuffer, {
                            ...pricingOverrideOptions,
                            forceForSale: true
                        });
                        gamePasses.created += 1;
                        gamePasses.createdItems.push({
                            sourceId: sourcePass.sourceId,
                            createdId: Number(created && created.gamePassId) || null,
                            name: sourceName
                        });
                        if (iconWarning) {
                            gamePasses.warnings.push({
                                sourceId: sourcePass.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    }
                } catch (error) {
                    gamePasses.failed.push({
                        sourceId: sourcePass.sourceId,
                        name: sourceName,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_SOURCE_GAME_PASS_MS);
            }

            for (const targetPass of indexedTargetGamePasses.allEntries) {
                if (matchedTargetGamePassIds.has(targetPass.id)) {
                    continue;
                }

                gamePasses.attempted += 1;

                try {
                    await archiveMonetizationItemWithNameFallback(
                        targetPass.id,
                        async (nameOverride, imageBuffer) => updateGamePass(targetUniverseId, targetPass.id, targetPass.config, imageBuffer, {
                            ...pricingOverrideOptions,
                            nameOverride,
                            forceForSale: false,
                            forceRegionalPricingEnabled: false
                        }),
                        gamePasses.warnings,
                        {
                            sourceId: null,
                            targetId: targetPass.id,
                            name: targetPass.name
                        }
                    );
                    gamePasses.archived += 1;
                    gamePasses.archivedItems.push({
                        targetId: targetPass.id,
                        name: targetPass.name
                    });
                } catch (error) {
                    gamePasses.failed.push({
                        sourceId: null,
                        targetId: targetPass.id,
                        name: targetPass.name,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_ARCHIVE_GAME_PASS_MS);
            }

            for (const sourceProduct of preparedDeveloperProducts) {
                developerProducts.attempted += 1;
                const sourceName = String(
                    sourceProduct && sourceProduct.config && sourceProduct.config.name ? sourceProduct.config.name : ''
                ).trim();
                const sourceNameKey = normalizeNameKey(sourceName);
                const iconWarning = sourceProduct.imageWarning
                    ? `${sourceProduct.imageWarning}. Synced without icon.`
                    : null;

                const matchedTargetProductByName = consumeMatchByName(
                    indexedTargetDeveloperProducts.byName,
                    sourceNameKey,
                    matchedTargetDeveloperProductIds
                );
                const matchedArchivedProduct = matchedTargetProductByName
                    ? null
                    : consumeArchivedEntry(indexedTargetDeveloperProducts.archivedEntries, matchedTargetDeveloperProductIds);
                const matchedTargetProduct = matchedTargetProductByName || matchedArchivedProduct;

                try {
                    if (matchedTargetProduct) {
                        await updateDeveloperProduct(
                            targetUniverseId,
                            matchedTargetProduct.id,
                            sourceProduct.config,
                            sourceProduct.imageBuffer,
                            {
                                ...pricingOverrideOptions,
                                forceForSale: true
                            }
                        );
                        matchedTargetDeveloperProductIds.add(matchedTargetProduct.id);
                        developerProducts.updated += 1;
                        developerProducts.updatedItems.push({
                            sourceId: sourceProduct.sourceId,
                            targetId: matchedTargetProduct.id,
                            name: sourceName,
                            recycledFromArchive: Boolean(matchedArchivedProduct)
                        });
                        if (iconWarning) {
                            developerProducts.warnings.push({
                                sourceId: sourceProduct.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    } else {
                        const created = await createDeveloperProduct(
                            targetUniverseId,
                            sourceProduct.config,
                            sourceProduct.imageBuffer,
                            {
                                ...pricingOverrideOptions,
                                forceForSale: true
                            }
                        );
                        developerProducts.created += 1;
                        developerProducts.createdItems.push({
                            sourceId: sourceProduct.sourceId,
                            createdId: Number(created && created.productId) || null,
                            name: sourceName
                        });
                        if (iconWarning) {
                            developerProducts.warnings.push({
                                sourceId: sourceProduct.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    }
                } catch (error) {
                    developerProducts.failed.push({
                        sourceId: sourceProduct.sourceId,
                        name: sourceName,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_SOURCE_DEVELOPER_PRODUCT_MS);
            }

            for (const targetProduct of indexedTargetDeveloperProducts.allEntries) {
                if (matchedTargetDeveloperProductIds.has(targetProduct.id)) {
                    continue;
                }

                developerProducts.attempted += 1;

                try {
                    await archiveMonetizationItemWithNameFallback(
                        targetProduct.id,
                        async (nameOverride, imageBuffer) => updateDeveloperProduct(
                            targetUniverseId,
                            targetProduct.id,
                            targetProduct.config,
                            imageBuffer,
                            {
                                ...pricingOverrideOptions,
                                nameOverride,
                                forceForSale: false,
                                forceRegionalPricingEnabled: false
                            }
                        ),
                        developerProducts.warnings,
                        {
                            sourceId: null,
                            targetId: targetProduct.id,
                            name: targetProduct.name
                        }
                    );
                    developerProducts.archived += 1;
                    developerProducts.archivedItems.push({
                        targetId: targetProduct.id,
                        name: targetProduct.name
                    });
                } catch (error) {
                    developerProducts.failed.push({
                        sourceId: null,
                        targetId: targetProduct.id,
                        name: targetProduct.name,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_ARCHIVE_DEVELOPER_PRODUCT_MS);
            }

            for (const sourceBadge of preparedBadges) {
                badges.attempted += 1;
                const sourceName = String(sourceBadge && sourceBadge.config && sourceBadge.config.name ? sourceBadge.config.name : '').trim();
                const sourceNameKey = normalizeNameKey(sourceName);
                const iconWarning = sourceBadge.imageWarning
                    ? `${sourceBadge.imageWarning}. Synced without icon.`
                    : null;

                const matchedTargetBadge = consumeMatchByName(
                    indexedTargetBadges.byName,
                    sourceNameKey,
                    matchedTargetBadgeIds
                );

                try {
                    if (matchedTargetBadge) {
                        await updateBadge(matchedTargetBadge.id, sourceBadge.config, {
                            forceEnabled: Boolean(sourceBadge && sourceBadge.config && sourceBadge.config.enabled)
                        });

                        if (sourceBadge.imageBuffer && sourceBadge.imageBuffer.length > 0) {
                            await updateBadgeIcon(matchedTargetBadge.id, sourceBadge.imageBuffer);
                        }

                        matchedTargetBadgeIds.add(matchedTargetBadge.id);
                        badges.updated += 1;
                        badges.updatedItems.push({
                            sourceId: sourceBadge.sourceId,
                            targetId: matchedTargetBadge.id,
                            name: sourceName
                        });
                        if (iconWarning) {
                            badges.warnings.push({
                                sourceId: sourceBadge.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    } else {
                        const created = await createBadge(
                            targetUniverseId,
                            sourceBadge.config,
                            sourceBadge.imageBuffer,
                            {
                                forceEnabled: Boolean(sourceBadge && sourceBadge.config && sourceBadge.config.enabled)
                            }
                        );
                        badges.created += 1;
                        badges.createdItems.push({
                            sourceId: sourceBadge.sourceId,
                            createdId: Number(created && created.id) || null,
                            name: sourceName
                        });
                        if (iconWarning) {
                            badges.warnings.push({
                                sourceId: sourceBadge.sourceId,
                                name: sourceName,
                                warning: iconWarning
                            });
                        }
                    }
                } catch (error) {
                    badges.failed.push({
                        sourceId: sourceBadge.sourceId,
                        name: sourceName,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_SOURCE_BADGE_MS);
            }

            for (const targetBadge of indexedTargetBadges.allEntries) {
                if (matchedTargetBadgeIds.has(targetBadge.id)) {
                    continue;
                }

                badges.attempted += 1;

                try {
                    const nameCandidates = buildArchiveNameCandidates(targetBadge.id);
                    let archived = false;
                    let lastBadgeError = null;

                    for (let index = 0; index < nameCandidates.length; index += 1) {
                        const nameOverride = nameCandidates[index];
                        try {
                            await updateBadge(targetBadge.id, targetBadge.config, {
                                nameOverride,
                                forceEnabled: false
                            });
                            try {
                                await updateBadgeIcon(targetBadge.id, ARCHIVED_ICON_BUFFER);
                            } catch (error) {
                                if (!isImageUploadError(error)) {
                                    throw error;
                                }

                                badges.warnings.push({
                                    sourceId: null,
                                    targetId: targetBadge.id,
                                    name: targetBadge.name,
                                    warning: 'Archived without replacing icon because Roblox rejected neutral icon upload'
                                });
                            }

                            archived = true;
                            break;
                        } catch (error) {
                            lastBadgeError = error;
                            if (isDuplicateNameError(error) && index < nameCandidates.length - 1) {
                                continue;
                            }
                            throw error;
                        }
                    }

                    if (!archived) {
                        throw lastBadgeError || new Error('Failed to archive badge');
                    }

                    badges.archived += 1;
                    badges.archivedItems.push({
                        targetId: targetBadge.id,
                        name: targetBadge.name
                    });
                } catch (error) {
                    badges.failed.push({
                        sourceId: null,
                        targetId: targetBadge.id,
                        name: targetBadge.name,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(COPY_SLEEP_ARCHIVE_BADGE_MS);
            }

            targets.push({
                targetUniverseId,
                gamePasses,
                developerProducts,
                badges
            });
        }

        const totalGamePassesCreated = targets.reduce((sum, item) => sum + item.gamePasses.created, 0);
        const totalGamePassesUpdated = targets.reduce((sum, item) => sum + item.gamePasses.updated, 0);
        const totalGamePassesArchived = targets.reduce((sum, item) => sum + item.gamePasses.archived, 0);
        const totalDeveloperProductsCreated = targets.reduce((sum, item) => sum + item.developerProducts.created, 0);
        const totalDeveloperProductsUpdated = targets.reduce((sum, item) => sum + item.developerProducts.updated, 0);
        const totalDeveloperProductsArchived = targets.reduce((sum, item) => sum + item.developerProducts.archived, 0);
        const totalBadgesCreated = targets.reduce((sum, item) => sum + item.badges.created, 0);
        const totalBadgesUpdated = targets.reduce((sum, item) => sum + item.badges.updated, 0);
        const totalBadgesArchived = targets.reduce((sum, item) => sum + item.badges.archived, 0);
        const totalGamePassFailures = targets.reduce((sum, item) => sum + item.gamePasses.failed.length, 0);
        const totalDeveloperProductFailures = targets.reduce((sum, item) => sum + item.developerProducts.failed.length, 0);
        const totalBadgeFailures = targets.reduce((sum, item) => sum + item.badges.failed.length, 0);
        const totalGamePassWarnings = targets.reduce((sum, item) => sum + item.gamePasses.warnings.length, 0);
        const totalDeveloperProductWarnings = targets.reduce((sum, item) => sum + item.developerProducts.warnings.length, 0);
        const totalBadgeWarnings = targets.reduce((sum, item) => sum + item.badges.warnings.length, 0);

        return sendJson(res, 200, {
            sourceUniverseId,
            targetUniverseIds,
            priceSyncMode: `Forced ${FORCED_TARGET_PRICE} Robux on Development and Test target universes`,
            sourceCounts: {
                gamePasses: preparedGamePasses.length,
                developerProducts: preparedDeveloperProducts.length,
                badges: preparedBadges.length
            },
            totals: {
                targetsProcessed: targets.length,
                totalGamePassesCreated,
                totalGamePassesUpdated,
                totalGamePassesArchived,
                totalDeveloperProductsCreated,
                totalDeveloperProductsUpdated,
                totalDeveloperProductsArchived,
                totalBadgesCreated,
                totalBadgesUpdated,
                totalBadgesArchived,
                totalGamePassFailures,
                totalDeveloperProductFailures,
                totalBadgeFailures,
                totalGamePassWarnings,
                totalDeveloperProductWarnings,
                totalBadgeWarnings
            },
            limitations: [
                'Roblox Open Cloud does not currently provide delete endpoints for game passes, developer products, or badges. Unmatched items are archived (renamed to [ARCHIVED] <item-id>), set off-sale/disabled, and assigned a blank icon. Archived game passes/products are reused for future source items when possible.'
            ],
            targets
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: error.message || 'Failed to copy monetization items'
        });
    } finally {
        releaseMonetizationLock(lockOwnerId);
    }
};
