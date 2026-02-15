const { methodNotAllowed, readJsonBody, sendJson } = require('../_lib/http');
const { requireUserFromSession } = require('../_lib/session');
const { getAdminGroupId, fetchUserGroupRole, getRoleRank } = require('../_lib/roblox-groups');
const {
    parseUniverseId,
    parseTargetUniverseIds,
    listAllGamePassConfigs,
    listAllDeveloperProductConfigs,
    getGamePassThumbnailUrlMap,
    getDeveloperProductThumbnailUrlMap,
    getAssetThumbnailUrlMap,
    downloadImageBuffer,
    createGamePass,
    updateGamePass,
    createDeveloperProduct,
    updateDeveloperProduct,
    sleep
} = require('../_lib/roblox-open-cloud');

const FORCED_TARGET_PRICE = 1;
const ARCHIVED_NAME_PREFIX = '[ARCHIVED] ';

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
        let imageError = null;

        if (!thumbnailUrl) {
            imageError = `${kindLabel} thumbnail URL was not available`;
        } else {
            try {
                imageBuffer = await downloadImageBuffer(thumbnailUrl);
            } catch (error) {
                imageError = error.message || 'Failed to download icon image';
            }
        }

        hydrated.push({
            sourceId,
            config,
            imageBuffer,
            imageError
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
        createdItems: [],
        updatedItems: [],
        archivedItems: []
    };
}

function normalizeNameKey(value) {
    return String(value || '').trim().toLowerCase();
}

function buildTargetNameIndex(configs, idFieldName) {
    const allEntries = [];
    const byName = new Map();

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
        byName
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

function buildArchivedName(name) {
    const rawName = String(name || '').trim();
    if (!rawName) {
        return ARCHIVED_NAME_PREFIX.trim();
    }

    const lowerPrefix = ARCHIVED_NAME_PREFIX.toLowerCase();
    if (rawName.toLowerCase().startsWith(lowerPrefix)) {
        return rawName;
    }

    return `${ARCHIVED_NAME_PREFIX}${rawName}`;
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
        let sourceUniverseId;
        let parsedTargetUniverseIds;
        try {
            sourceUniverseId = parseUniverseId(body && body.sourceUniverseId, 'sourceUniverseId');
            parsedTargetUniverseIds = parseTargetUniverseIds(body && body.targetUniverseIds);
        } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid request body' });
        }

        const targetUniverseIds = parsedTargetUniverseIds.filter((id) => id !== sourceUniverseId);

        if (targetUniverseIds.length === 0) {
            return sendJson(res, 400, { error: 'At least one target universe ID is required (different from source)' });
        }

        const sourceGamePasses = await listAllGamePassConfigs(sourceUniverseId);
        const sourceDeveloperProducts = await listAllDeveloperProductConfigs(sourceUniverseId);

        const gamePassThumbnailMap = await getGamePassThumbnailUrlMap(
            sourceGamePasses.map((item) => Number(item && item.gamePassId)).filter((id) => Number.isFinite(id))
        );
        const developerProductThumbnailMap = await getDeveloperProductThumbnailUrlMap(
            sourceDeveloperProducts.map((item) => Number(item && item.productId)).filter((id) => Number.isFinite(id))
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

        const targets = [];

        for (const targetUniverseId of targetUniverseIds) {
            const gamePasses = buildResultBucket();
            const developerProducts = buildResultBucket();

            const existingTargetGamePasses = await listAllGamePassConfigs(targetUniverseId);
            const existingTargetDeveloperProducts = await listAllDeveloperProductConfigs(targetUniverseId);
            const indexedTargetGamePasses = buildTargetNameIndex(existingTargetGamePasses, 'gamePassId');
            const indexedTargetDeveloperProducts = buildTargetNameIndex(existingTargetDeveloperProducts, 'productId');
            const matchedTargetGamePassIds = new Set();
            const matchedTargetDeveloperProductIds = new Set();

            for (const sourcePass of preparedGamePasses) {
                gamePasses.attempted += 1;
                const sourceName = String(sourcePass && sourcePass.config && sourcePass.config.name ? sourcePass.config.name : '').trim();
                const sourceNameKey = normalizeNameKey(sourceName);

                if (sourcePass.imageError || !sourcePass.imageBuffer) {
                    gamePasses.failed.push({
                        sourceId: sourcePass.sourceId,
                        name: sourceName,
                        error: sourcePass.imageError || 'Image data unavailable'
                    });
                    continue;
                }

                const matchedTargetPass = consumeMatchByName(
                    indexedTargetGamePasses.byName,
                    sourceNameKey,
                    matchedTargetGamePassIds
                );

                try {
                    if (matchedTargetPass) {
                        await updateGamePass(targetUniverseId, matchedTargetPass.id, sourcePass.config, sourcePass.imageBuffer, {
                            fixedPrice: FORCED_TARGET_PRICE,
                            forceForSale: true,
                            forceRegionalPricingEnabled: false
                        });
                        matchedTargetGamePassIds.add(matchedTargetPass.id);
                        gamePasses.updated += 1;
                        gamePasses.updatedItems.push({
                            sourceId: sourcePass.sourceId,
                            targetId: matchedTargetPass.id,
                            name: sourceName
                        });
                    } else {
                        const created = await createGamePass(targetUniverseId, sourcePass.config, sourcePass.imageBuffer, {
                            fixedPrice: FORCED_TARGET_PRICE,
                            forceForSale: true,
                            forceRegionalPricingEnabled: false
                        });
                        gamePasses.created += 1;
                        gamePasses.createdItems.push({
                            sourceId: sourcePass.sourceId,
                            createdId: Number(created && created.gamePassId) || null,
                            name: sourceName
                        });
                    }
                } catch (error) {
                    gamePasses.failed.push({
                        sourceId: sourcePass.sourceId,
                        name: sourceName,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(250);
            }

            for (const targetPass of indexedTargetGamePasses.allEntries) {
                if (matchedTargetGamePassIds.has(targetPass.id)) {
                    continue;
                }

                gamePasses.attempted += 1;

                try {
                    await updateGamePass(targetUniverseId, targetPass.id, targetPass.config, null, {
                        nameOverride: buildArchivedName(targetPass.name),
                        fixedPrice: FORCED_TARGET_PRICE,
                        forceForSale: false,
                        forceRegionalPricingEnabled: false
                    });
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

                await sleep(150);
            }

            for (const sourceProduct of preparedDeveloperProducts) {
                developerProducts.attempted += 1;
                const sourceName = String(
                    sourceProduct && sourceProduct.config && sourceProduct.config.name ? sourceProduct.config.name : ''
                ).trim();
                const sourceNameKey = normalizeNameKey(sourceName);

                if (sourceProduct.imageError || !sourceProduct.imageBuffer) {
                    developerProducts.failed.push({
                        sourceId: sourceProduct.sourceId,
                        name: sourceName,
                        error: sourceProduct.imageError || 'Image data unavailable'
                    });
                    continue;
                }

                const matchedTargetProduct = consumeMatchByName(
                    indexedTargetDeveloperProducts.byName,
                    sourceNameKey,
                    matchedTargetDeveloperProductIds
                );

                try {
                    if (matchedTargetProduct) {
                        await updateDeveloperProduct(
                            targetUniverseId,
                            matchedTargetProduct.id,
                            sourceProduct.config,
                            sourceProduct.imageBuffer,
                            {
                                fixedPrice: FORCED_TARGET_PRICE,
                                forceForSale: true,
                                forceRegionalPricingEnabled: false
                            }
                        );
                        matchedTargetDeveloperProductIds.add(matchedTargetProduct.id);
                        developerProducts.updated += 1;
                        developerProducts.updatedItems.push({
                            sourceId: sourceProduct.sourceId,
                            targetId: matchedTargetProduct.id,
                            name: sourceName
                        });
                    } else {
                        const created = await createDeveloperProduct(
                            targetUniverseId,
                            sourceProduct.config,
                            sourceProduct.imageBuffer,
                            {
                                fixedPrice: FORCED_TARGET_PRICE,
                                forceForSale: true,
                                forceRegionalPricingEnabled: false
                            }
                        );
                        developerProducts.created += 1;
                        developerProducts.createdItems.push({
                            sourceId: sourceProduct.sourceId,
                            createdId: Number(created && created.productId) || null,
                            name: sourceName
                        });
                    }
                } catch (error) {
                    developerProducts.failed.push({
                        sourceId: sourceProduct.sourceId,
                        name: sourceName,
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(400);
            }

            for (const targetProduct of indexedTargetDeveloperProducts.allEntries) {
                if (matchedTargetDeveloperProductIds.has(targetProduct.id)) {
                    continue;
                }

                developerProducts.attempted += 1;

                try {
                    await updateDeveloperProduct(targetUniverseId, targetProduct.id, targetProduct.config, null, {
                        nameOverride: buildArchivedName(targetProduct.name),
                        fixedPrice: FORCED_TARGET_PRICE,
                        forceForSale: false,
                        forceRegionalPricingEnabled: false
                    });
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

                await sleep(250);
            }

            targets.push({
                targetUniverseId,
                gamePasses,
                developerProducts
            });
        }

        const totalGamePassesCreated = targets.reduce((sum, item) => sum + item.gamePasses.created, 0);
        const totalGamePassesUpdated = targets.reduce((sum, item) => sum + item.gamePasses.updated, 0);
        const totalGamePassesArchived = targets.reduce((sum, item) => sum + item.gamePasses.archived, 0);
        const totalDeveloperProductsCreated = targets.reduce((sum, item) => sum + item.developerProducts.created, 0);
        const totalDeveloperProductsUpdated = targets.reduce((sum, item) => sum + item.developerProducts.updated, 0);
        const totalDeveloperProductsArchived = targets.reduce((sum, item) => sum + item.developerProducts.archived, 0);
        const totalGamePassFailures = targets.reduce((sum, item) => sum + item.gamePasses.failed.length, 0);
        const totalDeveloperProductFailures = targets.reduce((sum, item) => sum + item.developerProducts.failed.length, 0);

        return sendJson(res, 200, {
            sourceUniverseId,
            targetPriceRobux: FORCED_TARGET_PRICE,
            sourceCounts: {
                gamePasses: preparedGamePasses.length,
                developerProducts: preparedDeveloperProducts.length
            },
            totals: {
                targetsProcessed: targets.length,
                totalGamePassesCreated,
                totalGamePassesUpdated,
                totalGamePassesArchived,
                totalDeveloperProductsCreated,
                totalDeveloperProductsUpdated,
                totalDeveloperProductsArchived,
                totalGamePassFailures,
                totalDeveloperProductFailures
            },
            limitations: [
                'Roblox Open Cloud does not currently provide delete endpoints for game passes or developer products. Unmatched target items are renamed with an [ARCHIVED] prefix and archived (isForSale=false) instead of deleted.'
            ],
            targets
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: error.message || 'Failed to copy monetization items'
        });
    }
};
