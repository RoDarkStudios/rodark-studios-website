const ROBLOX_OPEN_CLOUD_BASE_URL = 'https://apis.roblox.com';
const ROBLOX_THUMBNAILS_BASE_URL = 'https://thumbnails.roblox.com';

function getRobloxOpenCloudApiKey() {
    const apiKey = String(process.env.ROBLOX_OPEN_CLOUD_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('ROBLOX_OPEN_CLOUD_API_KEY must be set');
    }

    return apiKey;
}

function parseUniverseId(value, fieldName) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} must be a positive integer`);
    }

    return parsed;
}

function parseTargetUniverseIds(rawList) {
    const list = Array.isArray(rawList) ? rawList : [];
    const seen = new Set();
    const parsed = [];

    for (const value of list) {
        const id = parseUniverseId(value, 'targetUniverseIds[]');
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        parsed.push(id);
    }

    return parsed;
}

async function parseJsonSafely(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

function extractApiErrorMessage(data, fallback) {
    if (!data || typeof data !== 'object') {
        return fallback;
    }

    const detail = [
        data.errorMessage,
        data.error,
        data.message,
        data.detail,
        data.title
    ].find((value) => typeof value === 'string' && value.trim());

    if (!detail) {
        return fallback;
    }

    return detail.trim();
}

function asPriceValue(config) {
    const price = Number(config && config.priceInformation && config.priceInformation.defaultPriceInRobux);
    if (!Number.isFinite(price) || price <= 0) {
        return null;
    }

    return Math.round(price);
}

function isRegionalPricingEnabled(config) {
    const features = config && config.priceInformation && Array.isArray(config.priceInformation.enabledFeatures)
        ? config.priceInformation.enabledFeatures
        : [];

    return features.includes('RegionalPricing');
}

async function robloxOpenCloudRequest({ method, path, query, body }) {
    const url = new URL(`${ROBLOX_OPEN_CLOUD_BASE_URL}${path}`);
    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === '') {
                continue;
            }
            url.searchParams.set(key, String(value));
        }
    }

    const headers = {
        'x-api-key': getRobloxOpenCloudApiKey()
    };

    const options = {
        method,
        headers
    };

    if (body) {
        options.body = body;
    }

    const response = await fetch(url, options);
    const data = await parseJsonSafely(response);

    if (!response.ok) {
        const fallback = `Roblox Open Cloud request failed (${response.status})`;
        throw new Error(extractApiErrorMessage(data, fallback));
    }

    return data;
}

async function listAllGamePassConfigs(universeId) {
    const results = [];
    let pageToken = '';

    do {
        const payload = await robloxOpenCloudRequest({
            method: 'GET',
            path: `/game-passes/v1/universes/${universeId}/game-passes/creator`,
            query: {
                pageSize: 100,
                pageToken: pageToken || undefined
            }
        });

        const rows = Array.isArray(payload && payload.gamePasses) ? payload.gamePasses : [];
        results.push(...rows);
        pageToken = payload && payload.nextPageToken ? String(payload.nextPageToken) : '';
    } while (pageToken);

    return results;
}

async function listAllDeveloperProductConfigs(universeId) {
    const results = [];
    let pageToken = '';

    do {
        const payload = await robloxOpenCloudRequest({
            method: 'GET',
            path: `/developer-products/v2/universes/${universeId}/developer-products/creator`,
            query: {
                pageSize: 100,
                pageToken: pageToken || undefined
            }
        });

        const rows = Array.isArray(payload && payload.developerProducts) ? payload.developerProducts : [];
        results.push(...rows);
        pageToken = payload && payload.nextPageToken ? String(payload.nextPageToken) : '';
    } while (pageToken);

    return results;
}

async function getThumbnailUrlMap({ endpointPath, idParamName, ids, size }) {
    const map = new Map();
    const cleanIds = Array.isArray(ids) ? ids.filter((id) => Number.isFinite(Number(id))) : [];
    if (cleanIds.length === 0) {
        return map;
    }

    const chunkSize = 50;
    for (let start = 0; start < cleanIds.length; start += chunkSize) {
        const chunk = cleanIds.slice(start, start + chunkSize);
        const url = new URL(`${ROBLOX_THUMBNAILS_BASE_URL}${endpointPath}`);
        url.searchParams.set(idParamName, chunk.join(','));
        url.searchParams.set('size', size);
        url.searchParams.set('format', 'Png');
        url.searchParams.set('isCircular', 'false');

        const response = await fetch(url, { method: 'GET' });
        const payload = await parseJsonSafely(response);
        if (!response.ok) {
            continue;
        }

        const rows = Array.isArray(payload && payload.data) ? payload.data : [];
        for (const row of rows) {
            const targetId = Number(row && row.targetId);
            const imageUrl = row && typeof row.imageUrl === 'string' ? row.imageUrl.trim() : '';
            if (!Number.isFinite(targetId) || !imageUrl) {
                continue;
            }
            map.set(targetId, imageUrl);
        }
    }

    return map;
}

async function getGamePassThumbnailUrlMap(gamePassIds) {
    return getThumbnailUrlMap({
        endpointPath: '/v1/game-passes',
        idParamName: 'gamePassIds',
        ids: gamePassIds,
        size: '150x150'
    });
}

async function getDeveloperProductThumbnailUrlMap(productIds) {
    return getThumbnailUrlMap({
        endpointPath: '/v1/developer-products/icons',
        idParamName: 'developerProductIds',
        ids: productIds,
        size: '420x420'
    });
}

async function getAssetThumbnailUrlMap(assetIds, size) {
    return getThumbnailUrlMap({
        endpointPath: '/v1/assets',
        idParamName: 'assetIds',
        ids: assetIds,
        size: size || '420x420'
    });
}

async function downloadImageBuffer(url) {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Image download failed (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

function addCommonMonetizationFields(formData, sourceConfig, imageBuffer) {
    const name = String((sourceConfig && sourceConfig.name) || '').trim();
    if (!name) {
        throw new Error('Source item is missing a name');
    }

    formData.append('name', name);

    if (typeof sourceConfig.description === 'string') {
        formData.append('description', sourceConfig.description);
    }

    formData.append('isForSale', sourceConfig && sourceConfig.isForSale ? 'true' : 'false');

    const priceValue = asPriceValue(sourceConfig);
    if (priceValue !== null) {
        formData.append('price', String(priceValue));
    }

    formData.append('isRegionalPricingEnabled', isRegionalPricingEnabled(sourceConfig) ? 'true' : 'false');

    if (imageBuffer && imageBuffer.length > 0) {
        formData.append('imageFile', new Blob([imageBuffer], { type: 'image/png' }), 'icon.png');
    }
}

async function createGamePass(universeId, sourceConfig, imageBuffer) {
    const formData = new FormData();
    addCommonMonetizationFields(formData, sourceConfig, imageBuffer);

    const payload = await robloxOpenCloudRequest({
        method: 'POST',
        path: `/game-passes/v1/universes/${universeId}/game-passes`,
        body: formData
    });

    return payload || null;
}

async function createDeveloperProduct(universeId, sourceConfig, imageBuffer) {
    const formData = new FormData();
    addCommonMonetizationFields(formData, sourceConfig, imageBuffer);

    const payload = await robloxOpenCloudRequest({
        method: 'POST',
        path: `/developer-products/v2/universes/${universeId}/developer-products`,
        body: formData
    });

    return payload || null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
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
};
