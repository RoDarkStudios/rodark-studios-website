async function postJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload || {})
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    if (!response.ok) {
        const errorMessage = data.error || `Request failed (${response.status})`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function getUserUsername(user) {
    if (user && typeof user.username === 'string' && user.username.trim()) {
        return user.username.trim();
    }

    if (!user || !user.user_metadata || typeof user.user_metadata.username !== 'string') {
        return '';
    }

    return user.user_metadata.username.trim();
}

function setAdminTabVisibility(isVisible) {
    const navAdminItem = document.getElementById('nav-admin-item');
    if (!navAdminItem) {
        return;
    }

    if (isVisible) {
        navAdminItem.classList.remove('hidden');
        return;
    }

    navAdminItem.classList.add('hidden');
}

function readAuthStatusFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const hasAuthParams = params.has('auth') || params.has('reason');
    if (!hasAuthParams) {
        return;
    }

    params.delete('auth');
    params.delete('reason');
    const cleanedSearch = params.toString();
    const nextUrl = `${window.location.pathname}${cleanedSearch ? `?${cleanedSearch}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
}

function setNavbarUsername(user) {
    const navUsername = document.getElementById('nav-username');
    const navSignoutBtn = document.getElementById('nav-signout-btn');
    if (!navUsername) {
        return;
    }

    const username = getUserUsername(user);
    if (username) {
        navUsername.textContent = `@${username}`;
        navUsername.classList.remove('guest');
        navUsername.removeAttribute('aria-label');
        if (navSignoutBtn) {
            navSignoutBtn.classList.remove('hidden');
        }
        return;
    }

    navUsername.textContent = 'Sign in with Roblox';
    navUsername.classList.add('guest');
    navUsername.setAttribute('aria-label', 'Sign in with Roblox');
    if (navSignoutBtn) {
        navSignoutBtn.classList.add('hidden');
    }
}

function setAuthUi(user) {
    setNavbarUsername(user);
    setAdminTabVisibility(false);
}

async function fetchAdminStatus() {
    try {
        const response = await fetch('/api/auth/admin', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            return { isAdmin: false };
        }

        const data = await response.json();
        return {
            isAdmin: Boolean(data && data.isAdmin)
        };
    } catch (error) {
        return { isAdmin: false };
    }
}

async function refreshAuthUi() {
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            setAuthUi(null);
            return;
        }

        const data = await response.json();
        const user = data.user || null;
        setAuthUi(user);

        if (!user) {
            return;
        }

        const adminStatus = await fetchAdminStatus();
        setAdminTabVisibility(adminStatus.isAdmin);
    } catch (error) {
        setAuthUi(null);
    }
}

function handleRobloxLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(returnTo || '/')}`;
    window.location.href = loginUrl;
}

async function handleSignOut() {
    const navSignoutBtn = document.getElementById('nav-signout-btn');
    if (!navSignoutBtn) {
        return;
    }

    navSignoutBtn.disabled = true;

    try {
        await postJson('/api/auth/logout', {});
    } catch (error) {
        // Keep UI consistent even if backend signout fails unexpectedly.
    } finally {
        await refreshAuthUi();
        navSignoutBtn.disabled = false;
    }
}

function initAuth() {
    const navUsername = document.getElementById('nav-username');
    const navSignoutBtn = document.getElementById('nav-signout-btn');

    readAuthStatusFromQuery();
    refreshAuthUi();

    if (navUsername) {
        navUsername.addEventListener('click', () => {
            if (navUsername.classList.contains('guest')) {
                handleRobloxLogin();
            }
        });
    }

    if (navSignoutBtn) {
        navSignoutBtn.addEventListener('click', handleSignOut);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let cachedAdminGameConfig = null;
let cachedAdminGameConfigAt = 0;
const ADMIN_GAME_CONFIG_CACHE_TTL_MS = 10 * 1000;
const MISSING_GAME_CONFIG_MESSAGE = 'Game IDs are not configured. Open Admin, click Game IDs, and save Production/Test/Development universe IDs.';

function toPositiveIntegerOrNull(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function normalizeAdminGameConfig(config) {
    if (!config || typeof config !== 'object') {
        return null;
    }

    const productionUniverseId = toPositiveIntegerOrNull(config.productionUniverseId);
    const testUniverseId = toPositiveIntegerOrNull(config.testUniverseId);
    const developmentUniverseId = toPositiveIntegerOrNull(config.developmentUniverseId);
    if (!productionUniverseId || !testUniverseId || !developmentUniverseId) {
        return null;
    }

    return {
        productionUniverseId,
        testUniverseId,
        developmentUniverseId,
        updatedAt: config.updatedAt ? String(config.updatedAt) : null,
        updatedByUserId: config.updatedByUserId ? String(config.updatedByUserId) : null,
        updatedByUsername: config.updatedByUsername ? String(config.updatedByUsername) : null
    };
}

function formatAdminGameConfigLabel(config) {
    if (!config) {
        return MISSING_GAME_CONFIG_MESSAGE;
    }

    return `Shared IDs -> Production: ${config.productionUniverseId} | Test: ${config.testUniverseId} | Development: ${config.developmentUniverseId}`;
}

function setAdminGameConfigBanner(elementId, config) {
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }

    element.textContent = formatAdminGameConfigLabel(config);
    element.classList.remove('hidden');
}

async function fetchAdminGameConfig(options) {
    const settings = options || {};
    const force = Boolean(settings.force);
    const now = Date.now();

    if (!force && cachedAdminGameConfigAt > 0 && (now - cachedAdminGameConfigAt) < ADMIN_GAME_CONFIG_CACHE_TTL_MS) {
        return cachedAdminGameConfig;
    }

    const result = await postJson('/api/admin/roblox-list-monetization-items', {
        operation: 'game-config:get'
    });
    const config = normalizeAdminGameConfig(result && result.config ? result.config : null);

    cachedAdminGameConfig = config;
    cachedAdminGameConfigAt = now;
    return config;
}

async function saveAdminGameConfig(configInput) {
    const payload = {
        operation: 'game-config:save',
        productionUniverseId: String(configInput && configInput.productionUniverseId ? configInput.productionUniverseId : '').trim(),
        testUniverseId: String(configInput && configInput.testUniverseId ? configInput.testUniverseId : '').trim(),
        developmentUniverseId: String(configInput && configInput.developmentUniverseId ? configInput.developmentUniverseId : '').trim()
    };

    const result = await postJson('/api/admin/roblox-list-monetization-items', payload);
    const config = normalizeAdminGameConfig(result && result.config ? result.config : null);
    cachedAdminGameConfig = config;
    cachedAdminGameConfigAt = Date.now();
    return config;
}

async function requireAdminGameConfig(setStatus) {
    const config = await fetchAdminGameConfig({ force: true });
    if (config) {
        return config;
    }

    if (typeof setStatus === 'function') {
        setStatus(MISSING_GAME_CONFIG_MESSAGE, 'error');
    }

    throw new Error(MISSING_GAME_CONFIG_MESSAGE);
}

function setAdminCopyStatus(message, type) {
    const statusElement = document.getElementById('copy-monetization-status');
    if (!statusElement) {
        return;
    }

    if (!message) {
        statusElement.textContent = '';
        statusElement.classList.add('hidden');
        statusElement.classList.remove('success', 'error', 'info');
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
    statusElement.classList.remove('success', 'error', 'info');
    statusElement.classList.add(type || 'info');
}

function setAdminCopyBusy(isBusy) {
    const submitButton = document.getElementById('copy-monetization-submit');
    const testPriceModeSelect = document.getElementById('copy-monetization-test-price-mode');
    if (submitButton) {
        submitButton.disabled = Boolean(isBusy);
        submitButton.textContent = isBusy ? 'Copying...' : 'Start Copy';
    }
    if (testPriceModeSelect) {
        testPriceModeSelect.disabled = Boolean(isBusy);
    }
}

function readAdminCopyTestPriceMode() {
    const selectElement = document.getElementById('copy-monetization-test-price-mode');
    const selectedValue = String(selectElement && selectElement.value ? selectElement.value : '').trim();
    if (selectedValue === 'match-production') {
        return 'match-production';
    }

    return 'force-one-robux';
}

const DEFAULT_ADMIN_COPY_ESTIMATE_MS = 3 * 60 * 1000;
const ADMIN_COPY_ACTIVE_MAX_PERCENT = 97;
let adminCopyProgressTimerId = null;
let adminCopyProgressStartedAt = 0;

function getAdminCopyProgressElements() {
    return {
        root: document.getElementById('copy-monetization-progress'),
        label: document.getElementById('copy-progress-label'),
        percent: document.getElementById('copy-progress-percent'),
        track: document.querySelector('#copy-monetization-progress .admin-copy-progress-track'),
        fill: document.getElementById('copy-progress-fill'),
        meta: document.getElementById('copy-progress-meta')
    };
}

function formatDurationClock(totalMs) {
    const ms = Number(totalMs);
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function setAdminCopyProgressState(options) {
    const elements = getAdminCopyProgressElements();
    if (!elements.root) {
        return;
    }

    const settings = options || {};
    const isVisible = settings.visible !== false;
    const percentNumber = Math.max(0, Math.min(100, Number(settings.percent) || 0));
    const label = String(settings.label || '').trim();
    const meta = String(settings.meta || '').trim();

    if (!isVisible) {
        elements.root.classList.add('hidden');
        return;
    }

    elements.root.classList.remove('hidden');
    if (elements.label) {
        elements.label.textContent = label || 'Copy in progress...';
    }
    if (elements.percent) {
        elements.percent.textContent = `${Math.round(percentNumber)}%`;
    }
    if (elements.fill) {
        elements.fill.style.width = `${percentNumber}%`;
    }
    if (elements.track) {
        elements.track.setAttribute('aria-valuenow', String(Math.round(percentNumber)));
    }
    if (elements.meta) {
        elements.meta.textContent = meta || `Elapsed ${formatDurationClock(0)}`;
    }
}

function stopAdminCopyProgressTimer() {
    if (adminCopyProgressTimerId !== null) {
        clearInterval(adminCopyProgressTimerId);
        adminCopyProgressTimerId = null;
    }
}

function resetAdminCopyProgress() {
    stopAdminCopyProgressTimer();
    adminCopyProgressStartedAt = 0;
    setAdminCopyProgressState({ visible: false });
}

function startAdminCopyProgress(estimatedDurationMs) {
    stopAdminCopyProgressTimer();
    adminCopyProgressStartedAt = Date.now();
    const estimateMs = Number.isFinite(Number(estimatedDurationMs)) && Number(estimatedDurationMs) > 0
        ? Number(estimatedDurationMs)
        : DEFAULT_ADMIN_COPY_ESTIMATE_MS;

    const tick = () => {
        const elapsedMs = Date.now() - adminCopyProgressStartedAt;
        const ratio = elapsedMs / estimateMs;
        const percent = Math.min(ADMIN_COPY_ACTIVE_MAX_PERCENT, Math.max(1, Math.floor(ratio * 100)));
        const remainingMs = Math.max(0, estimateMs - elapsedMs);
        const isFinishing = elapsedMs >= estimateMs;
        setAdminCopyProgressState({
            visible: true,
            percent,
            label: isFinishing ? 'Finalizing copy...' : 'Copy in progress...',
            meta: `Elapsed ${formatDurationClock(elapsedMs)} | ETA ${formatDurationClock(remainingMs)}`
        });
    };

    tick();
    adminCopyProgressTimerId = window.setInterval(tick, 1000);
    return estimateMs;
}

function finishAdminCopyProgress(isSuccess) {
    if (adminCopyProgressStartedAt <= 0) {
        stopAdminCopyProgressTimer();
        setAdminCopyProgressState({ visible: false });
        return 0;
    }

    const elapsedMs = adminCopyProgressStartedAt > 0
        ? Date.now() - adminCopyProgressStartedAt
        : 0;
    stopAdminCopyProgressTimer();
    setAdminCopyProgressState({
        visible: true,
        percent: 100,
        label: isSuccess ? 'Copy finished' : 'Copy stopped',
        meta: `Elapsed ${formatDurationClock(elapsedMs)}`
    });
    adminCopyProgressStartedAt = 0;
    return elapsedMs;
}

async function fetchAdminCopyEstimate(gameConfig) {
    const estimate = await postJson('/api/admin/roblox-copy-monetization', {
        operation: 'estimate',
        productionUniverseId: gameConfig.productionUniverseId,
        testUniverseId: gameConfig.testUniverseId,
        developmentUniverseId: gameConfig.developmentUniverseId
    });

    const conservativeDurationMs = Number(estimate && estimate.conservativeDurationMs);
    const estimatedDurationMs = Number(estimate && estimate.estimatedDurationMs);
    const durationMs = Number.isFinite(conservativeDurationMs) && conservativeDurationMs > 0
        ? conservativeDurationMs
        : estimatedDurationMs;

    return {
        durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null
    };
}

function renderAdminCopyResults(result) {
    const resultElement = document.getElementById('copy-monetization-results');
    if (!resultElement) {
        return;
    }

    if (!result || typeof result !== 'object') {
        resultElement.innerHTML = '';
        resultElement.classList.add('hidden');
        return;
    }

    const summary = result.totals || {};
    const sourceCounts = result.sourceCounts || {};
    const targetRows = Array.isArray(result.targets) ? result.targets : [];
    const getFailureId = (item) => {
        const sourceId = Number(item && item.sourceId);
        if (Number.isFinite(sourceId) && sourceId > 0) {
            return sourceId;
        }

        const targetId = Number(item && item.targetId);
        if (Number.isFinite(targetId) && targetId > 0) {
            return targetId;
        }

        return 'Unknown';
    };

    const targetMarkup = targetRows.map((target) => {
        const targetEnvironment = String(target && target.environment ? target.environment : '').trim();
        const targetUniverseId = target && target.targetUniverseId;
        const targetLabel = targetEnvironment
            ? `${targetEnvironment.charAt(0).toUpperCase()}${targetEnvironment.slice(1)} Universe ${targetUniverseId}`
            : `Target Universe ${targetUniverseId}`;
        const gamePasses = target && target.gamePasses ? target.gamePasses : {};
        const developerProducts = target && target.developerProducts ? target.developerProducts : {};
        const badges = target && target.badges ? target.badges : {};
        const gamePassFailures = Array.isArray(gamePasses.failed)
            ? gamePasses.failed
            : [];
        const developerProductFailures = Array.isArray(developerProducts.failed)
            ? developerProducts.failed
            : [];
        const badgeFailures = Array.isArray(badges.failed)
            ? badges.failed
            : [];

        const combinedFailures = []
            .concat(gamePassFailures.map((item) => `Game pass ${getFailureId(item)}: ${item.error}`))
            .concat(developerProductFailures.map((item) => `Product ${getFailureId(item)}: ${item.error}`))
            .concat(badgeFailures.map((item) => `Badge ${getFailureId(item)}: ${item.error}`));

        const failurePreview = combinedFailures.slice(0, 5).map((line) => escapeHtml(line)).join('\n');

        return `
            <article class="admin-target-result">
                <h4>${escapeHtml(targetLabel)}</h4>
                <p>Game passes: ${escapeHtml(gamePasses.created)} created, ${escapeHtml(gamePasses.updated)} updated, ${escapeHtml(gamePasses.archived)} archived</p>
                <p>Developer products: ${escapeHtml(developerProducts.created)} created, ${escapeHtml(developerProducts.updated)} updated, ${escapeHtml(developerProducts.archived)} archived</p>
                <p>Badges: ${escapeHtml(badges.created)} created, ${escapeHtml(badges.updated)} updated, ${escapeHtml(badges.archived)} archived</p>
                ${failurePreview ? `<p class="admin-target-errors">${failurePreview}</p>` : ''}
            </article>
        `;
    }).join('');

    resultElement.innerHTML = `
        <section class="admin-result-summary">
            <p>Source items: ${escapeHtml(sourceCounts.gamePasses)} game passes, ${escapeHtml(sourceCounts.developerProducts)} developer products, ${escapeHtml(sourceCounts.badges)} badges</p>
            <p>Pricing mode: ${escapeHtml(result && result.priceSyncMode ? result.priceSyncMode : 'Unknown')}</p>
            <p>Game passes: ${escapeHtml(summary.totalGamePassesCreated)} created, ${escapeHtml(summary.totalGamePassesUpdated)} updated, ${escapeHtml(summary.totalGamePassesArchived)} archived</p>
            <p>Developer products: ${escapeHtml(summary.totalDeveloperProductsCreated)} created, ${escapeHtml(summary.totalDeveloperProductsUpdated)} updated, ${escapeHtml(summary.totalDeveloperProductsArchived)} archived</p>
            <p>Badges: ${escapeHtml(summary.totalBadgesCreated)} created, ${escapeHtml(summary.totalBadgesUpdated)} updated, ${escapeHtml(summary.totalBadgesArchived)} archived</p>
            <p>Failures: ${escapeHtml(summary.totalGamePassFailures)} game passes, ${escapeHtml(summary.totalDeveloperProductFailures)} developer products, ${escapeHtml(summary.totalBadgeFailures)} badges</p>
        </section>
        ${targetMarkup}
    `;
    resultElement.classList.remove('hidden');
}

async function handleAdminCopySubmit(event) {
    event.preventDefault();

    setAdminCopyBusy(true);
    renderAdminCopyResults(null);
    resetAdminCopyProgress();
    setAdminCopyStatus('Preparing copy job...', 'info');

    try {
        const gameConfig = await requireAdminGameConfig(setAdminCopyStatus);
        const testPriceMode = readAdminCopyTestPriceMode();
        setAdminGameConfigBanner('copy-monetization-config', gameConfig);

        setAdminCopyStatus('Estimating copy duration...', 'info');
        let estimateDurationMs = null;
        try {
            const estimate = await fetchAdminCopyEstimate(gameConfig);
            estimateDurationMs = estimate && Number.isFinite(Number(estimate.durationMs))
                ? Number(estimate.durationMs)
                : null;
        } catch (error) {
            estimateDurationMs = null;
        }

        const resolvedEstimateMs = startAdminCopyProgress(estimateDurationMs);
        setAdminCopyStatus(
            `Copy job started. Estimated duration around ${formatDurationClock(resolvedEstimateMs)}.`,
            'info'
        );

        const result = await postJson('/api/admin/roblox-copy-monetization', {
            productionUniverseId: gameConfig.productionUniverseId,
            testUniverseId: gameConfig.testUniverseId,
            developmentUniverseId: gameConfig.developmentUniverseId,
            testPriceMode
        });

        const elapsedMs = finishAdminCopyProgress(true);
        renderAdminCopyResults(result);

        const hasFailures = result
            && result.totals
            && (
                (Number(result.totals.totalGamePassFailures) || 0)
                + (Number(result.totals.totalDeveloperProductFailures) || 0)
                + (Number(result.totals.totalBadgeFailures) || 0)
                > 0
            );

        setAdminCopyStatus(
            hasFailures
                ? `Copy finished with some failures in ${formatDurationClock(elapsedMs)}. See details below.`
                : `Copy completed successfully in ${formatDurationClock(elapsedMs)}.`,
            hasFailures ? 'error' : 'success'
        );
    } catch (error) {
        const elapsedMs = finishAdminCopyProgress(false);
        setAdminCopyStatus(
            elapsedMs > 0
                ? `${error.message || 'Failed to copy monetization data.'} (after ${formatDurationClock(elapsedMs)})`
                : (error.message || 'Failed to copy monetization data.'),
            'error'
        );
    } finally {
        setAdminCopyBusy(false);
    }
}

async function initAdminCopyTool() {
    const adminTool = document.getElementById('admin-copy-tool');
    if (!adminTool) {
        return;
    }

    resetAdminCopyProgress();

    const deniedElement = document.getElementById('admin-access-denied');
    const form = document.getElementById('copy-monetization-form');

    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        adminTool.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    adminTool.classList.remove('hidden');
    try {
        const gameConfig = await fetchAdminGameConfig({ force: true });
        setAdminGameConfigBanner('copy-monetization-config', gameConfig);
        if (!gameConfig) {
            setAdminCopyStatus(MISSING_GAME_CONFIG_MESSAGE, 'error');
        }
    } catch (error) {
        setAdminCopyStatus(error.message || 'Failed to load shared game IDs.', 'error');
    }

    if (form) {
        form.addEventListener('submit', handleAdminCopySubmit);
    }
}

function setListMonetizationStatus(message, type) {
    const statusElement = document.getElementById('list-monetization-status');
    if (!statusElement) {
        return;
    }

    if (!message) {
        statusElement.textContent = '';
        statusElement.classList.add('hidden');
        statusElement.classList.remove('success', 'error', 'info');
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
    statusElement.classList.remove('success', 'error', 'info');
    statusElement.classList.add(type || 'info');
}

function setListMonetizationBusy(isBusy) {
    const submitButton = document.getElementById('list-monetization-submit');
    if (!submitButton) {
        return;
    }

    submitButton.disabled = Boolean(isBusy);
    submitButton.textContent = isBusy ? 'Fetching...' : 'Fetch IDs';
}

function formatMonetizationRows(items, emptyLabel) {
    if (!Array.isArray(items) || items.length === 0) {
        return emptyLabel;
    }

    return items.map((item) => {
        const name = String(item && item.name ? item.name : '').trim() || '(Unnamed)';
        const id = Number(item && item.id);
        return `${name} - ${Number.isFinite(id) ? id : 'Unknown ID'}`;
    }).join('\n');
}

function buildMonetizationBlobText(result) {
    const games = Array.isArray(result && result.games) ? result.games : [];
    if (games.length === 0) {
        return 'No monetization data returned.';
    }

    return games.map((game) => {
        const label = String(game && game.label ? game.label : 'Game');
        const universeId = Number(game && game.universeId);
        const errorMessage = String(game && game.error ? game.error : '').trim();
        const gamePasses = Array.isArray(game && game.gamePasses) ? game.gamePasses : [];
        const developerProducts = Array.isArray(game && game.developerProducts) ? game.developerProducts : [];

        const lines = [
            `${label} (Universe ${Number.isFinite(universeId) ? universeId : 'Unknown'})`,
            'Gamepasses:',
            formatMonetizationRows(gamePasses, 'No gamepasses found'),
            '',
            'Products:',
            formatMonetizationRows(developerProducts, 'No products found')
        ];

        if (errorMessage) {
            lines.push('', `Error: ${errorMessage}`);
        }

        return lines.join('\n');
    }).join('\n\n------------------------------\n\n');
}

function renderListMonetizationResults(result) {
    const resultElement = document.getElementById('list-monetization-results');
    if (!resultElement) {
        return;
    }

    if (!result || typeof result !== 'object') {
        resultElement.innerHTML = '';
        resultElement.classList.add('hidden');
        return;
    }

    const combinedText = String(result && result.combinedText ? result.combinedText : '').trim();
    const blobText = combinedText || buildMonetizationBlobText(result);

    resultElement.innerHTML = `
        <article class="admin-target-result">
            <label class="admin-label admin-catalog-label">All Games Monetization IDs</label>
            <textarea class="admin-catalog-output admin-catalog-output-lg" readonly>${escapeHtml(blobText)}</textarea>
        </article>
    `;

    resultElement.classList.remove('hidden');
}

async function handleListMonetizationSubmit(event) {
    event.preventDefault();

    setListMonetizationBusy(true);
    renderListMonetizationResults(null);
    setListMonetizationStatus('Fetching monetization items...', 'info');

    try {
        const gameConfig = await requireAdminGameConfig(setListMonetizationStatus);
        setAdminGameConfigBanner('list-monetization-config', gameConfig);

        const result = await postJson('/api/admin/roblox-list-monetization-items', {
            productionUniverseId: gameConfig.productionUniverseId,
            testUniverseId: gameConfig.testUniverseId,
            developmentUniverseId: gameConfig.developmentUniverseId
        });

        renderListMonetizationResults(result);

        const games = Array.isArray(result && result.games) ? result.games : [];
        const failed = games.some((game) => String(game && game.error ? game.error : '').trim().length > 0);
        setListMonetizationStatus(
            failed
                ? 'Completed with some failures. See details below.'
                : 'Completed successfully.',
            failed ? 'error' : 'success'
        );
    } catch (error) {
        setListMonetizationStatus(error.message || 'Failed to list monetization items.', 'error');
    } finally {
        setListMonetizationBusy(false);
    }
}

async function initAdminListMonetizationTool() {
    const toolElement = document.getElementById('admin-list-monetization-tool');
    if (!toolElement) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const form = document.getElementById('list-monetization-form');

    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        toolElement.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    toolElement.classList.remove('hidden');
    try {
        const gameConfig = await fetchAdminGameConfig({ force: true });
        setAdminGameConfigBanner('list-monetization-config', gameConfig);
        if (!gameConfig) {
            setListMonetizationStatus(MISSING_GAME_CONFIG_MESSAGE, 'error');
        }
    } catch (error) {
        setListMonetizationStatus(error.message || 'Failed to load shared game IDs.', 'error');
    }

    if (form) {
        form.addEventListener('submit', handleListMonetizationSubmit);
    }
}

function setDescriptionSyncStatus(message, type) {
    const statusElement = document.getElementById('description-sync-status');
    if (!statusElement) {
        return;
    }

    if (!message) {
        statusElement.textContent = '';
        statusElement.classList.add('hidden');
        statusElement.classList.remove('success', 'error', 'info');
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
    statusElement.classList.remove('success', 'error', 'info');
    statusElement.classList.add(type || 'info');
}

function setLiveConfigSyncStatus(message, type) {
    const statusElement = document.getElementById('live-config-sync-status');
    if (!statusElement) {
        return;
    }

    if (!message) {
        statusElement.textContent = '';
        statusElement.classList.add('hidden');
        statusElement.classList.remove('success', 'error', 'info');
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
    statusElement.classList.remove('success', 'error', 'info');
    statusElement.classList.add(type || 'info');
}

function setLiveConfigSyncBusy(isBusy) {
    const syncButton = document.getElementById('sync-live-config-btn');
    if (!syncButton) {
        return;
    }

    syncButton.disabled = Boolean(isBusy);
    syncButton.textContent = isBusy
        ? 'Publishing to Test + Development...'
        : 'Sync Production to Test + Development';
}

function stringifyPrettyJson(value) {
    try {
        return JSON.stringify(value ?? {}, null, 2);
    } catch (error) {
        return '{}';
    }
}

function formatLiveConfigSummary(entry) {
    if (!entry || typeof entry !== 'object') {
        return 'No config data returned.';
    }

    const label = String(entry.label || 'Game');
    const universeId = Number(entry.universeId);
    const configVersion = Number(entry.configVersion);
    const entryCount = Number(entry.entryCount);

    return [
        `${label}`,
        `Universe ID: ${Number.isFinite(universeId) ? universeId : 'Unknown'}`,
        `Config version: ${Number.isFinite(configVersion) ? configVersion : 'Unknown'}`,
        `Entries: ${Number.isFinite(entryCount) ? entryCount : 'Unknown'}`
    ].join('\n');
}

function renderLiveConfigSyncResults(result) {
    const resultElement = document.getElementById('live-config-sync-results');
    if (!resultElement) {
        return;
    }

    if (!result || typeof result !== 'object') {
        resultElement.innerHTML = '';
        resultElement.classList.add('hidden');
        return;
    }

    const source = result.source || null;
    const targets = Array.isArray(result.targets)
        ? result.targets
        : (Array.isArray(result.successes) ? result.successes : []);
    const failures = Array.isArray(result.failures) ? result.failures : [];
    const repository = String(result.repository || 'InExperienceConfig');
    const note = String(result.note || '').trim();

    const failureText = failures.map((item) => {
        const label = String(item && item.label ? item.label : 'Target');
        const universeId = Number(item && item.universeId);
        const error = String(item && item.error ? item.error : 'Unknown error');
        return `${label} (${Number.isFinite(universeId) ? universeId : 'Unknown'}): ${error}`;
    }).join('\n');

    const targetMarkup = targets.map((target) => `
        <article class="admin-target-result">
            <label class="admin-label admin-catalog-label">${escapeHtml(String(target && target.label ? target.label : 'Target'))} Summary</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(formatLiveConfigSummary(target))}</textarea>
            <label class="admin-label admin-catalog-label">${escapeHtml(String(target && target.label ? target.label : 'Target'))} Published Entries</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(stringifyPrettyJson(target && target.publishedEntries ? target.publishedEntries : {}))}</textarea>
        </article>
    `).join('');

    resultElement.innerHTML = `
        <article class="admin-target-result">
            <label class="admin-label admin-catalog-label">Repository</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(`${repository}${note ? `\n\n${note}` : ''}`)}</textarea>
            <label class="admin-label admin-catalog-label">Production Summary</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(formatLiveConfigSummary(source))}</textarea>
            <label class="admin-label admin-catalog-label">Production Published Entries</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(stringifyPrettyJson(source && source.publishedEntries ? source.publishedEntries : {}))}</textarea>
            ${source && source.fullEntries ? `
                <label class="admin-label admin-catalog-label">Production Full Entries + Metadata</label>
                <textarea class="admin-catalog-output" readonly>${escapeHtml(stringifyPrettyJson(source.fullEntries))}</textarea>
            ` : ''}
            ${failureText ? `
                <label class="admin-label admin-catalog-label">Failures</label>
                <textarea class="admin-catalog-output" readonly>${escapeHtml(failureText)}</textarea>
            ` : ''}
        </article>
        ${targetMarkup}
    `;

    resultElement.classList.remove('hidden');
}

function setDescriptionLoadBusy(isBusy) {
    const loadButton = document.getElementById('load-production-description-btn');
    if (!loadButton) {
        return;
    }

    loadButton.disabled = Boolean(isBusy);
    loadButton.textContent = isBusy
        ? 'Loading Production Description...'
        : 'Load Production Description';
}

function setDescriptionSaveBusy(isBusy) {
    const saveButton = document.getElementById('save-description-sync-btn');
    if (!saveButton) {
        return;
    }

    saveButton.disabled = Boolean(isBusy);
    saveButton.textContent = isBusy
        ? 'Saving to All 3 Games...'
        : 'Save to All 3 Games';
}

function renderDescriptionSyncResults(result) {
    const resultElement = document.getElementById('description-sync-results');
    if (!resultElement) {
        return;
    }

    if (!result || typeof result !== 'object') {
        resultElement.innerHTML = '';
        resultElement.classList.add('hidden');
        return;
    }

    const updates = Array.isArray(result && result.updates) ? result.updates : [];
    const updateLines = updates.map((item) => {
        const label = String(item && item.label ? item.label : 'Game');
        const universeId = Number(item && item.universeId);
        const placeId = Number(item && item.placeId);
        return `${label}: Universe ${Number.isFinite(universeId) ? universeId : 'Unknown'} (Root Place ${Number.isFinite(placeId) ? placeId : 'Unknown'})`;
    }).join('\n');

    const productionDescription = String(result && result.productionDescription ? result.productionDescription : '');
    const testDescription = String(result && result.testDescription ? result.testDescription : '');
    const developmentDescription = String(result && result.developmentDescription ? result.developmentDescription : '');

    resultElement.innerHTML = `
        <article class="admin-target-result">
            <label class="admin-label admin-catalog-label">Updated Games</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(updateLines || 'No update details returned')}</textarea>
            <label class="admin-label admin-catalog-label">Saved Production Description</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(productionDescription)}</textarea>
            <label class="admin-label admin-catalog-label">Saved Test Description</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(testDescription)}</textarea>
            <label class="admin-label admin-catalog-label">Saved Development Description</label>
            <textarea class="admin-catalog-output" readonly>${escapeHtml(developmentDescription)}</textarea>
        </article>
    `;

    resultElement.classList.remove('hidden');
}

function getDescriptionSyncFormValues() {
    const descriptionInput = document.getElementById('game-description-text');

    return {
        description: String(descriptionInput && descriptionInput.value ? descriptionInput.value : '')
    };
}

async function handleLiveConfigSyncSubmit(event) {
    event.preventDefault();

    setLiveConfigSyncBusy(true);
    setLiveConfigSyncStatus('Publishing Production live config to Test and Development...', 'info');
    renderLiveConfigSyncResults(null);

    try {
        const gameConfig = await requireAdminGameConfig(setLiveConfigSyncStatus);
        setAdminGameConfigBanner('live-config-sync-config', gameConfig);

        const result = await postJson('/api/admin/roblox-list-monetization-items', {
            operation: 'config:sync',
            repository: 'InExperienceConfig',
            productionUniverseId: gameConfig.productionUniverseId,
            testUniverseId: gameConfig.testUniverseId,
            developmentUniverseId: gameConfig.developmentUniverseId
        });

        renderLiveConfigSyncResults(result);
        setLiveConfigSyncStatus('Live configs published successfully for Test and Development.', 'success');
    } catch (error) {
        if (error && error.data) {
            renderLiveConfigSyncResults(error.data);
        }
        setLiveConfigSyncStatus(error.message || 'Failed to sync live configs.', 'error');
    } finally {
        setLiveConfigSyncBusy(false);
    }
}

async function handleLoadProductionDescriptionClick() {
    setDescriptionLoadBusy(true);
    setDescriptionSyncStatus('Loading current Production description...', 'info');
    renderDescriptionSyncResults(null);

    try {
        const gameConfig = await requireAdminGameConfig(setDescriptionSyncStatus);
        setAdminGameConfigBanner('description-sync-config', gameConfig);

        const result = await postJson('/api/admin/roblox-list-monetization-items', {
            operation: 'load',
            productionUniverseId: gameConfig.productionUniverseId,
            testUniverseId: gameConfig.testUniverseId,
            developmentUniverseId: gameConfig.developmentUniverseId
        });

        const descriptionInput = document.getElementById('game-description-text');
        if (descriptionInput) {
            descriptionInput.value = String(result && result.productionDescription ? result.productionDescription : '');
            descriptionInput.dataset.loadedProductionUniverseId = String(gameConfig.productionUniverseId);
        }

        setDescriptionSyncStatus('Production description loaded. Edit and save when ready.', 'success');
    } catch (error) {
        setDescriptionSyncStatus(error.message || 'Failed to load Production description.', 'error');
    } finally {
        setDescriptionLoadBusy(false);
    }
}

async function handleDescriptionSyncSubmit(event) {
    event.preventDefault();

    const values = getDescriptionSyncFormValues();
    setDescriptionSaveBusy(true);
    setDescriptionSyncStatus('Saving descriptions to Production, Test, and Development...', 'info');
    renderDescriptionSyncResults(null);

    try {
        const gameConfig = await requireAdminGameConfig(setDescriptionSyncStatus);
        setAdminGameConfigBanner('description-sync-config', gameConfig);

        const result = await postJson('/api/admin/roblox-list-monetization-items', {
            operation: 'save',
            productionUniverseId: gameConfig.productionUniverseId,
            testUniverseId: gameConfig.testUniverseId,
            developmentUniverseId: gameConfig.developmentUniverseId,
            description: values.description
        });

        const descriptionInput = document.getElementById('game-description-text');
        if (descriptionInput) {
            descriptionInput.value = String(result && result.productionDescription ? result.productionDescription : '');
            descriptionInput.dataset.loadedProductionUniverseId = String(gameConfig.productionUniverseId);
        }

        renderDescriptionSyncResults(result);
        setDescriptionSyncStatus('Descriptions updated successfully for all 3 games.', 'success');
    } catch (error) {
        setDescriptionSyncStatus(error.message || 'Failed to save game descriptions.', 'error');
    } finally {
        setDescriptionSaveBusy(false);
    }
}

async function initAdminDescriptionSyncTool() {
    const toolElement = document.getElementById('admin-description-sync-tool');
    if (!toolElement) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const form = document.getElementById('description-sync-form');
    const descriptionInput = document.getElementById('game-description-text');

    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        toolElement.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    toolElement.classList.remove('hidden');

    try {
        const gameConfig = await fetchAdminGameConfig({ force: true });
        setAdminGameConfigBanner('description-sync-config', gameConfig);
        if (!gameConfig) {
            setDescriptionSyncStatus(MISSING_GAME_CONFIG_MESSAGE, 'error');
        } else if (descriptionInput && !String(descriptionInput.value || '').trim()) {
            await handleLoadProductionDescriptionClick();
        }
    } catch (error) {
        setDescriptionSyncStatus(error.message || 'Failed to load shared game IDs.', 'error');
    }

    if (form) {
        form.addEventListener('submit', handleDescriptionSyncSubmit);
    }
}

async function initAdminLiveConfigSyncTool() {
    const toolElement = document.getElementById('admin-live-config-sync-tool');
    if (!toolElement) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const form = document.getElementById('live-config-sync-form');

    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        toolElement.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    toolElement.classList.remove('hidden');

    try {
        const gameConfig = await fetchAdminGameConfig({ force: true });
        setAdminGameConfigBanner('live-config-sync-config', gameConfig);
        if (!gameConfig) {
            setLiveConfigSyncStatus(MISSING_GAME_CONFIG_MESSAGE, 'error');
        } else {
            setLiveConfigSyncStatus(
                'Ready to overwrite and publish Test and Development from the current published Production config.',
                'info'
            );
        }
    } catch (error) {
        setLiveConfigSyncStatus(error.message || 'Failed to load shared game IDs.', 'error');
    }

    if (form) {
        form.addEventListener('submit', handleLiveConfigSyncSubmit);
    }
}

function setGameConfigStatus(message, type) {
    const statusElement = document.getElementById('game-config-status');
    if (!statusElement) {
        return;
    }

    if (!message) {
        statusElement.textContent = '';
        statusElement.classList.add('hidden');
        statusElement.classList.remove('success', 'error', 'info');
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
    statusElement.classList.remove('success', 'error', 'info');
    statusElement.classList.add(type || 'info');
}

function setGameConfigBusy(isBusy) {
    const button = document.getElementById('game-config-save-btn');
    if (!button) {
        return;
    }

    button.disabled = Boolean(isBusy);
    button.textContent = isBusy ? 'Saving...' : 'Save Game IDs';
}

function renderGameConfigResults(config) {
    const resultElement = document.getElementById('game-config-results');
    if (!resultElement) {
        return;
    }

    if (!config) {
        resultElement.innerHTML = '';
        resultElement.classList.add('hidden');
        return;
    }

    const updatedAtValue = config.updatedAt ? new Date(config.updatedAt) : null;
    const updatedAt = updatedAtValue && !Number.isNaN(updatedAtValue.getTime())
        ? updatedAtValue.toLocaleString()
        : 'Unknown';
    const updatedBy = config.updatedByUsername
        ? `@${config.updatedByUsername}`
        : (config.updatedByUserId ? `User ${config.updatedByUserId}` : 'Unknown');

    resultElement.innerHTML = `
        <article class="admin-target-result">
            <p>Production Universe: ${escapeHtml(config.productionUniverseId)}</p>
            <p>Test Universe: ${escapeHtml(config.testUniverseId)}</p>
            <p>Development Universe: ${escapeHtml(config.developmentUniverseId)}</p>
            <p>Last updated: ${escapeHtml(updatedAt)} by ${escapeHtml(updatedBy)}</p>
        </article>
    `;
    resultElement.classList.remove('hidden');
}

function readGameConfigFormValues() {
    const productionInput = document.getElementById('config-production-universe-id');
    const testInput = document.getElementById('config-test-universe-id');
    const developmentInput = document.getElementById('config-development-universe-id');

    return {
        productionUniverseId: String(productionInput && productionInput.value ? productionInput.value : '').trim(),
        testUniverseId: String(testInput && testInput.value ? testInput.value : '').trim(),
        developmentUniverseId: String(developmentInput && developmentInput.value ? developmentInput.value : '').trim()
    };
}

function writeGameConfigFormValues(config) {
    const productionInput = document.getElementById('config-production-universe-id');
    const testInput = document.getElementById('config-test-universe-id');
    const developmentInput = document.getElementById('config-development-universe-id');

    if (productionInput) {
        productionInput.value = config && config.productionUniverseId ? String(config.productionUniverseId) : '';
    }
    if (testInput) {
        testInput.value = config && config.testUniverseId ? String(config.testUniverseId) : '';
    }
    if (developmentInput) {
        developmentInput.value = config && config.developmentUniverseId ? String(config.developmentUniverseId) : '';
    }
}

async function handleGameConfigSubmit(event) {
    event.preventDefault();

    const values = readGameConfigFormValues();
    if (!values.productionUniverseId || !values.testUniverseId || !values.developmentUniverseId) {
        setGameConfigStatus('Please enter Production, Test, and Development universe IDs.', 'error');
        return;
    }

    setGameConfigBusy(true);
    setGameConfigStatus('Saving game IDs...', 'info');

    try {
        const config = await saveAdminGameConfig(values);
        if (!config) {
            throw new Error('Game IDs save returned no IDs');
        }

        writeGameConfigFormValues(config);
        renderGameConfigResults(config);
        setGameConfigStatus('Game IDs saved successfully.', 'success');
    } catch (error) {
        setGameConfigStatus(error.message || 'Failed to save game IDs.', 'error');
    } finally {
        setGameConfigBusy(false);
    }
}

async function initAdminGameConfigTool() {
    const toolElement = document.getElementById('admin-game-config-tool');
    if (!toolElement) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const form = document.getElementById('game-config-form');

    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        toolElement.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    toolElement.classList.remove('hidden');

    try {
        const config = await fetchAdminGameConfig({ force: true });
        if (config) {
            writeGameConfigFormValues(config);
            renderGameConfigResults(config);
        } else {
            setGameConfigStatus('No game IDs saved yet. Enter IDs and save.', 'info');
            renderGameConfigResults(null);
        }
    } catch (error) {
        setGameConfigStatus(error.message || 'Failed to load game IDs.', 'error');
    }

    if (form) {
        form.addEventListener('submit', handleGameConfigSubmit);
    }
}

async function initAdminToolsDirectory() {
    const toolsList = document.getElementById('admin-tools-list');
    const systemsGateway = document.getElementById('admin-systems-gateway');
    const toolsHeading = document.getElementById('admin-tools-heading');
    if (!toolsList && !systemsGateway) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        if (toolsList) {
            toolsList.classList.add('hidden');
        }
        if (systemsGateway) {
            systemsGateway.classList.add('hidden');
        }
        if (toolsHeading) {
            toolsHeading.classList.add('hidden');
        }
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    if (systemsGateway) {
        systemsGateway.classList.remove('hidden');
    }
    if (toolsHeading) {
        toolsHeading.classList.remove('hidden');
    }
    if (toolsList) {
        toolsList.classList.remove('hidden');
    }
}

// Age calculation function
function calculateAge(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }

    return age;
}

// Function to shuffle team members randomly
function shuffleTeamMembers() {
    const teamGrid = document.getElementById('team-grid');
    if (!teamGrid) {
        return;
    }

    const teamMembers = Array.from(teamGrid.children);

    // Shuffle the array using Fisher-Yates algorithm
    for (let i = teamMembers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [teamMembers[i], teamMembers[j]] = [teamMembers[j], teamMembers[i]];
    }

    // Clear the grid and re-append in new order
    teamGrid.innerHTML = '';
    teamMembers.forEach(member => {
        teamGrid.appendChild(member);
    });    console.log('Team members shuffled for fairness!');
}

// Function to fetch game statistics from Roblox
async function fetchGameStats() {
    const visitCountElement = document.getElementById('visit-count');
    if (!visitCountElement) {
        return;
    }

    const placeId = 16230991879; // Coding Simulator place ID
    const universeId = 5602610435; // Pre-converted Universe ID to avoid API calls

    try {
        // Format numbers with commas
        function formatNumber(num) {
            return num.toLocaleString();
        }

        console.log('Fetching game statistics...');

        // Try to get game details using Universe ID
        try {
            const gameResponse = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
            console.log('API Response status:', gameResponse.status);

            if (gameResponse.ok) {
                const gameData = await gameResponse.json();
                console.log('Game data received:', gameData);

                if (gameData.data && gameData.data.length > 0) {
                    const game = gameData.data[0];
                    console.log('Processing game data:', game);
                      // Update visit count
                    if (game.visits !== undefined) {
                        console.log(`Setting visits to: ${formatNumber(game.visits)}`);
                        visitCountElement.textContent = formatNumber(game.visits);
                        console.log('✅ Game statistics updated successfully');
                        return;
                    } else {
                        console.warn('No visits data in response');
                    }
                } else {
                    console.warn('No game data in response');
                }
            } else {
                console.warn('API response not OK:', gameResponse.status);
            }
        } catch (error) {
            console.warn('API request failed:', error);
        }          // If API fails due to CORS or other issues, use the known accurate data
        console.log('API failed, using known accurate statistics...');

        // Use the actual current statistics we know from the API test
        const knownStats = {
            visits: 4354515  // 4.3M+ visits (actual current number)
        };

        visitCountElement.textContent = formatNumber(knownStats.visits);

        console.log('📊 Known accurate statistics loaded');

    } catch (error) {
        console.error('Failed to fetch game statistics:', error);
          // Show error state
        visitCountElement.textContent = 'N/A';
    }
}

async function fetchAllGameStats() {
    const featuredGameCards = Array.from(document.querySelectorAll('.game-card.featured[data-universe-id]'));
    if (!featuredGameCards.length) {
        return;
    }

    function formatNumber(num) {
        return num.toLocaleString();
    }

    async function fetchRobloxGames(universeIds) {
        const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeIds.join(','))}`, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`Games API failed (${response.status})`);
        }

        const payload = await response.json();
        const rows = Array.isArray(payload && payload.data) ? payload.data : [];
        return rows.map((row) => ({
            universeId: Number(row && row.id),
            rootPlaceId: Number(row && row.rootPlaceId),
            name: typeof (row && row.name) === 'string' ? row.name.trim() : '',
            visits: Number(row && row.visits)
        }));
    }

    function applyFallbackVisits(card) {
        const visitsElementId = String(card.dataset.visitsElementId || '').trim();
        if (!visitsElementId) {
            return;
        }

        const visitsElement = document.getElementById(visitsElementId);
        if (!visitsElement) {
            return;
        }

        const fallbackVisits = Number(card.dataset.fallbackVisits);
        visitsElement.textContent = Number.isFinite(fallbackVisits)
            ? formatNumber(Math.trunc(fallbackVisits))
            : 'N/A';
    }

    const universeIds = Array.from(new Set(
        featuredGameCards
            .map((card) => Number(card.dataset.universeId))
            .filter((universeId) => Number.isFinite(universeId) && universeId > 0)
    ));

    if (!universeIds.length) {
        featuredGameCards.forEach(applyFallbackVisits);
        return;
    }

    try {
        const games = await fetchRobloxGames(universeIds);
        const gamesByUniverseId = new Map(
            games.map((game) => [Number(game && game.universeId), game])
        );

        featuredGameCards.forEach((card) => {
            const universeId = Number(card.dataset.universeId);
            const game = gamesByUniverseId.get(universeId);
            if (!game) {
                applyFallbackVisits(card);
                return;
            }

            const titleElement = card.querySelector('[data-game-title]');
            if (titleElement && typeof game.name === 'string' && game.name.trim()) {
                titleElement.textContent = game.name.trim();
            }

            const imageElement = card.querySelector('.game-image');
            if (imageElement && typeof game.name === 'string' && game.name.trim()) {
                imageElement.alt = game.name.trim();
            }

            const rootPlaceId = Number(game.rootPlaceId);
            if (Number.isFinite(rootPlaceId) && rootPlaceId > 0) {
                card.querySelectorAll('[data-roblox-link]').forEach((link) => {
                    link.href = `https://www.roblox.com/games/${rootPlaceId}`;
                });
            }

            const visitsElementId = String(card.dataset.visitsElementId || '').trim();
            if (!visitsElementId) {
                return;
            }

            const visitsElement = document.getElementById(visitsElementId);
            if (!visitsElement) {
                return;
            }

            const visits = Number(game.visits);
            if (Number.isFinite(visits) && visits >= 0) {
                visitsElement.textContent = formatNumber(Math.trunc(visits));
                return;
            }

            applyFallbackVisits(card);
        });
    } catch (error) {
        console.error('Failed to fetch featured game metadata:', error);
        featuredGameCards.forEach(applyFallbackVisits);
    }
}

// Function to fetch group member count from Roblox
async function fetchGroupStats() {
    const groupMemberCountElement = document.getElementById('group-member-count');
    if (!groupMemberCountElement) {
        return;
    }

    try {
        function formatNumber(num) {
            return num.toLocaleString();
        }

        console.log('Fetching group statistics...');

        const groupStatsResponse = await fetch('/api/roblox/group-stats', {
            method: 'GET'
        });
        if (!groupStatsResponse.ok) {
            throw new Error(`Group stats API failed (${groupStatsResponse.status})`);
        }

        const groupStats = await groupStatsResponse.json();
        const memberCount = Number(groupStats && groupStats.memberCount);
        if (!Number.isFinite(memberCount) || memberCount < 0) {
            throw new Error('Group stats API returned invalid memberCount');
        }

        groupMemberCountElement.textContent = formatNumber(Math.trunc(memberCount));
        console.log('Group statistics updated successfully');

    } catch (error) {
        console.error('Failed to fetch group statistics:', error);
        groupMemberCountElement.textContent = 'Unavailable';
    }
}

// Bind fallback behavior for team avatar images rendered in HTML
function fetchUserAvatars() {
    const avatarElements = document.querySelectorAll('.member-avatar .avatar-image');
    if (!avatarElements.length) {
        return;
    }

    avatarElements.forEach((img) => {
        if (img.dataset.fallbackBound === '1') {
            return;
        }

        img.dataset.fallbackBound = '1';
        img.addEventListener('error', () => {
            const avatarElement = img.closest('.member-avatar');
            if (!avatarElement) {
                return;
            }

            avatarElement.innerHTML = '<i class="fas fa-user"></i>';
        }, { once: true });
    });
}

function initGamesCarousel() {
    const carousel = document.getElementById('games-carousel');
    const prevButton = document.getElementById('games-prev');
    const nextButton = document.getElementById('games-next');
    if (!carousel || !prevButton || !nextButton) {
        return;
    }

    const gameCards = Array.from(carousel.querySelectorAll('.game-card'));
    if (gameCards.length === 0) {
        return;
    }

    let activeIndex = gameCards.findIndex((card) => card.classList.contains('is-active'));
    if (activeIndex < 0) {
        activeIndex = 0;
    }

    function setActiveCard(nextIndex) {
        activeIndex = (nextIndex + gameCards.length) % gameCards.length;

        gameCards.forEach((card, index) => {
            const isActive = index === activeIndex;
            card.classList.toggle('is-active', isActive);
            card.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        });
    }

    function cycle(direction) {
        setActiveCard(activeIndex + direction);
    }

    const disableNav = gameCards.length <= 1;
    prevButton.disabled = disableNav;
    nextButton.disabled = disableNav;

    prevButton.addEventListener('click', () => cycle(-1));
    nextButton.addEventListener('click', () => cycle(1));

    carousel.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            cycle(-1);
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            cycle(1);
        }
    });

    setActiveCard(activeIndex);
}

// Update ages when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 RoDark Studios website loaded!');
    initAuth();
    initAdminToolsDirectory();
    initAdminCopyTool();
    initAdminListMonetizationTool();
    initAdminDescriptionSyncTool();
    initAdminLiveConfigSyncTool();
    initAdminGameConfigTool();

    // Calculate and display ages
    const myronAge = calculateAge('2008-05-31');
    const tristanAge = calculateAge('2004-12-25');
    const kasperAge = calculateAge('2004-12-25');

    const myronAgeElement = document.getElementById('myron-age');
    const tristanAgeElement = document.getElementById('tristan-age');
    const kasperAgeElement = document.getElementById('kasper-age');
    if (myronAgeElement) {
        myronAgeElement.textContent = myronAge;
    }
    if (tristanAgeElement) {
        tristanAgeElement.textContent = tristanAge;
    }
    if (kasperAgeElement) {
        kasperAgeElement.textContent = kasperAge;
    }

    // Update current year in footer
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
        currentYearElement.textContent = new Date().getFullYear();
    }

    // Shuffle team members randomly each time the page loads
    shuffleTeamMembers();
    initGamesCarousel();
    // Fetch and display game statistics
    fetchAllGameStats();

    // Fetch and display group statistics
    fetchGroupStats();
    // Bind fallback handlers for user avatars
    fetchUserAvatars();

    console.log('✅ All initialization functions called');
});

// Mobile navigation toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger && navMenu) {
    hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });
}

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offsetTop = target.offsetTop - 80; // Account for fixed navbar
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    });
});

// Navbar background on scroll
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) {
        return;
    }

    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(23, 23, 23, 0.98)';
    } else {
        navbar.style.background = 'rgba(23, 23, 23, 0.95)';
    }
});

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Add animation styles and observe elements
window.addEventListener('load', function() {
    const animatedElements = document.querySelectorAll('.team-member, .feature, .game-card, .social-link');

    animatedElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(el);
    });
});

// Add some interactive effects
document.addEventListener('DOMContentLoaded', function() {
    // Add click effect to buttons
    document.querySelectorAll('.btn').forEach(button => {
        button.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            ripple.classList.add('ripple');

            this.appendChild(ripple);

            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
});

// Add CSS for ripple effect
const style = document.createElement('style');
style.textContent = `
    .btn {
        position: relative;
        overflow: hidden;
    }

    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0);
        animation: ripple-animation 0.6s linear;
        pointer-events: none;
    }

    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
