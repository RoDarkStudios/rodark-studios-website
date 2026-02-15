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
    createDeveloperProduct,
    sleep
} = require('../_lib/roblox-open-cloud');

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
        failed: [],
        createdItems: []
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

            for (const sourcePass of preparedGamePasses) {
                gamePasses.attempted += 1;

                if (sourcePass.imageError || !sourcePass.imageBuffer) {
                    gamePasses.failed.push({
                        sourceId: sourcePass.sourceId,
                        name: String(sourcePass.config && sourcePass.config.name ? sourcePass.config.name : ''),
                        error: sourcePass.imageError || 'Image data unavailable'
                    });
                    continue;
                }

                try {
                    const created = await createGamePass(targetUniverseId, sourcePass.config, sourcePass.imageBuffer);
                    gamePasses.created += 1;
                    gamePasses.createdItems.push({
                        sourceId: sourcePass.sourceId,
                        createdId: Number(created && created.gamePassId) || null,
                        name: String(sourcePass.config && sourcePass.config.name ? sourcePass.config.name : '')
                    });
                } catch (error) {
                    gamePasses.failed.push({
                        sourceId: sourcePass.sourceId,
                        name: String(sourcePass.config && sourcePass.config.name ? sourcePass.config.name : ''),
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(250);
            }

            for (const sourceProduct of preparedDeveloperProducts) {
                developerProducts.attempted += 1;

                if (sourceProduct.imageError || !sourceProduct.imageBuffer) {
                    developerProducts.failed.push({
                        sourceId: sourceProduct.sourceId,
                        name: String(sourceProduct.config && sourceProduct.config.name ? sourceProduct.config.name : ''),
                        error: sourceProduct.imageError || 'Image data unavailable'
                    });
                    continue;
                }

                try {
                    const created = await createDeveloperProduct(
                        targetUniverseId,
                        sourceProduct.config,
                        sourceProduct.imageBuffer
                    );
                    developerProducts.created += 1;
                    developerProducts.createdItems.push({
                        sourceId: sourceProduct.sourceId,
                        createdId: Number(created && created.productId) || null,
                        name: String(sourceProduct.config && sourceProduct.config.name ? sourceProduct.config.name : '')
                    });
                } catch (error) {
                    developerProducts.failed.push({
                        sourceId: sourceProduct.sourceId,
                        name: String(sourceProduct.config && sourceProduct.config.name ? sourceProduct.config.name : ''),
                        error: error.message || 'Unknown error'
                    });
                }

                await sleep(400);
            }

            targets.push({
                targetUniverseId,
                gamePasses,
                developerProducts
            });
        }

        const totalGamePassesCreated = targets.reduce((sum, item) => sum + item.gamePasses.created, 0);
        const totalDeveloperProductsCreated = targets.reduce((sum, item) => sum + item.developerProducts.created, 0);
        const totalGamePassFailures = targets.reduce((sum, item) => sum + item.gamePasses.failed.length, 0);
        const totalDeveloperProductFailures = targets.reduce((sum, item) => sum + item.developerProducts.failed.length, 0);

        return sendJson(res, 200, {
            sourceUniverseId,
            sourceCounts: {
                gamePasses: preparedGamePasses.length,
                developerProducts: preparedDeveloperProducts.length
            },
            totals: {
                targetsProcessed: targets.length,
                totalGamePassesCreated,
                totalDeveloperProductsCreated,
                totalGamePassFailures,
                totalDeveloperProductFailures
            },
            targets
        });
    } catch (error) {
        return sendJson(res, 500, {
            error: error.message || 'Failed to copy monetization items'
        });
    }
};
