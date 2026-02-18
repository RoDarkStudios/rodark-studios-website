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
        throw new Error(errorMessage);
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
    if (submitButton) {
        submitButton.disabled = Boolean(isBusy);
        submitButton.textContent = isBusy ? 'Copying...' : 'Start Copy';
    }
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

    const targetMarkup = targetRows.map((target) => {
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
            .concat(gamePassFailures.map((item) => `Game pass ${item.sourceId}: ${item.error}`))
            .concat(developerProductFailures.map((item) => `Product ${item.sourceId}: ${item.error}`))
            .concat(badgeFailures.map((item) => `Badge ${item.sourceId || item.targetId}: ${item.error}`));

        const failurePreview = combinedFailures.slice(0, 5).map((line) => escapeHtml(line)).join('\n');

        return `
            <article class="admin-target-result">
                <h4>Target Universe ${escapeHtml(target.targetUniverseId)}</h4>
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

    const productionInput = document.getElementById('production-universe-id');
    const testInput = document.getElementById('test-universe-id');
    const developmentInput = document.getElementById('development-universe-id');
    if (!productionInput || !testInput || !developmentInput) {
        return;
    }

    const productionUniverseId = String(productionInput.value || '').trim();
    const testUniverseId = String(testInput.value || '').trim();
    const developmentUniverseId = String(developmentInput.value || '').trim();

    if (!productionUniverseId || !testUniverseId || !developmentUniverseId) {
        setAdminCopyStatus('Please enter Production, Test, and Development universe IDs.', 'error');
        return;
    }

    setAdminCopyBusy(true);
    renderAdminCopyResults(null);
    setAdminCopyStatus('Copy job started. This may take a while for large catalogs.', 'info');

    try {
        const result = await postJson('/api/admin/roblox-copy-monetization', {
            productionUniverseId,
            testUniverseId,
            developmentUniverseId
        });

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
                ? 'Copy finished with some failures. See details below.'
                : 'Copy completed successfully.',
            hasFailures ? 'error' : 'success'
        );
    } catch (error) {
        setAdminCopyStatus(error.message || 'Failed to copy monetization data.', 'error');
    } finally {
        setAdminCopyBusy(false);
    }
}

async function initAdminCopyTool() {
    const adminTool = document.getElementById('admin-copy-tool');
    if (!adminTool) {
        return;
    }

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

    const productionInput = document.getElementById('production-universe-id');
    const testInput = document.getElementById('test-universe-id');
    const developmentInput = document.getElementById('development-universe-id');
    if (!productionInput || !testInput || !developmentInput) {
        return;
    }

    const productionUniverseId = String(productionInput.value || '').trim();
    const testUniverseId = String(testInput.value || '').trim();
    const developmentUniverseId = String(developmentInput.value || '').trim();

    if (!productionUniverseId || !testUniverseId || !developmentUniverseId) {
        setListMonetizationStatus('Please enter Production, Test, and Development universe IDs.', 'error');
        return;
    }

    setListMonetizationBusy(true);
    renderListMonetizationResults(null);
    setListMonetizationStatus('Fetching monetization items...', 'info');

    try {
        const result = await postJson('/api/admin/roblox-list-monetization-items', {
            productionUniverseId,
            testUniverseId,
            developmentUniverseId
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

    if (form) {
        form.addEventListener('submit', handleListMonetizationSubmit);
    }
}

async function initAdminToolsDirectory() {
    const toolsList = document.getElementById('admin-tools-list');
    if (!toolsList) {
        return;
    }

    const deniedElement = document.getElementById('admin-access-denied');
    const adminStatus = await fetchAdminStatus();
    const isAdmin = Boolean(adminStatus && adminStatus.isAdmin);
    if (!isAdmin) {
        toolsList.classList.add('hidden');
        if (deniedElement) {
            deniedElement.classList.remove('hidden');
        }
        return;
    }

    if (deniedElement) {
        deniedElement.classList.add('hidden');
    }
    toolsList.classList.remove('hidden');
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
    const gameConfigs = [
        {
            elementId: 'visit-count',
            universeId: 5602610435,
            fallbackVisits: 4354515
        }
    ];

    const targets = gameConfigs
        .map((config) => ({
            ...config,
            element: document.getElementById(config.elementId)
        }))
        .filter((target) => target.element);

    if (!targets.length) {
        return;
    }

    function formatNumber(num) {
        return num.toLocaleString();
    }

    async function fetchVisitsForUniverse(universeId) {
        const gameResponse = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
        if (!gameResponse.ok) {
            throw new Error(`Games API failed (${gameResponse.status})`);
        }

        const gameData = await gameResponse.json();
        const games = Array.isArray(gameData && gameData.data) ? gameData.data : [];
        if (!games.length) {
            throw new Error('Games API returned no game data');
        }

        const matchingGame = games.find((game) => (
            Number(game && game.id) === universeId
            || Number(game && game.universeId) === universeId
        )) || games[0];

        const visits = Number(matchingGame && matchingGame.visits);
        if (!Number.isFinite(visits) || visits < 0) {
            throw new Error('Games API returned invalid visits');
        }

        return Math.trunc(visits);
    }

    await Promise.all(targets.map(async (target) => {
        try {
            const visits = await fetchVisitsForUniverse(target.universeId);
            target.element.textContent = formatNumber(visits);
        } catch (error) {
            if (Number.isFinite(target.fallbackVisits)) {
                target.element.textContent = formatNumber(target.fallbackVisits);
                return;
            }

            target.element.textContent = 'N/A';
        }
    }));
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

