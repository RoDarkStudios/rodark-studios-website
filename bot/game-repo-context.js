const path = require('path');

const GITHUB_API_BASE_URL = 'https://api.github.com';
const REPO_OWNER = String(process.env.SUPPORT_GAME_REPO_OWNER || 'RoDarkStudios').trim();
const REPO_NAME = String(process.env.SUPPORT_GAME_REPO_NAME || 'build-a-business').trim();
const REPO_BRANCH = String(process.env.SUPPORT_GAME_REPO_BRANCH || 'dev').trim();
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN || '').trim();
const REPO_REFRESH_MS = Number.parseInt(process.env.SUPPORT_GAME_REPO_REFRESH_MS || '900000', 10);
const MAX_INDEXED_FILES = Number.parseInt(process.env.SUPPORT_GAME_REPO_MAX_FILES || '600', 10);
const MAX_INDEXED_FILE_SIZE_BYTES = Number.parseInt(process.env.SUPPORT_GAME_REPO_MAX_FILE_SIZE_BYTES || '150000', 10);
const MAX_SNIPPETS = 4;
const MAX_SNIPPET_CHARS = 1400;
const MAX_SEARCH_RESULTS = 8;
const MAX_LIST_RESULTS = 60;
const MAX_READ_FILE_CHARS = 12000;
const MAX_READ_CHUNK_LINES = 220;

const SAFE_PATH_PREFIXES = [
    'src/ReplicatedFirst/',
    'src/ReplicatedStorage/',
    'src/StarterPlayerScripts/'
];

const SAFE_ROOT_FILES = new Set([
    'README.md',
    'default.project.json'
]);

const ALLOWED_EXTENSIONS = new Set([
    '.luau',
    '.lua',
    '.json',
    '.md',
    '.toml',
    '.txt'
]);

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'can',
    'did',
    'do',
    'for',
    'from',
    'get',
    'got',
    'had',
    'has',
    'have',
    'help',
    'how',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'just',
    'like',
    'me',
    'my',
    'need',
    'not',
    'of',
    'on',
    'or',
    'problem',
    'question',
    'that',
    'the',
    'them',
    'then',
    'this',
    'to',
    'was',
    'what',
    'when',
    'where',
    'which',
    'why',
    'with',
    'you',
    'your'
]);

let cachedIndex = null;
let loadingIndexPromise = null;

function hasGameRepoConfig() {
    return Boolean(REPO_OWNER && REPO_NAME && REPO_BRANCH && GITHUB_TOKEN);
}

function getGameRepoSummary() {
    return {
        owner: REPO_OWNER,
        repo: REPO_NAME,
        branch: REPO_BRANCH,
        safePathPrefixes: [...SAFE_PATH_PREFIXES]
    };
}

function buildApiUrl(pathname, searchParams) {
    const url = new URL(`${GITHUB_API_BASE_URL}${pathname}`);
    if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
    }
    return url.toString();
}

async function githubRequest(pathname, searchParams) {
    const response = await fetch(buildApiUrl(pathname, searchParams), {
        method: 'GET',
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            'User-Agent': 'rodark-discord-support-bot'
        },
        signal: AbortSignal.timeout(30000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = payload && payload.message ? payload.message : `GitHub API failed (${response.status})`;
        throw new Error(message);
    }

    return payload;
}

function isAllowedRepoPath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }

    if (SAFE_ROOT_FILES.has(filePath)) {
        return true;
    }

    if (!SAFE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
        return false;
    }

    return ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function decodeGitHubContent(payload) {
    if (!payload || typeof payload.content !== 'string') {
        return '';
    }

    return Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

function findIndexedFile(repoIndex, repoPath) {
    if (!repoIndex || !Array.isArray(repoIndex.files)) {
        return null;
    }

    const normalizedPath = String(repoPath || '').trim().replace(/\\/g, '/');
    if (!normalizedPath) {
        return null;
    }

    return repoIndex.files.find((entry) => entry && entry.path === normalizedPath) || null;
}

function normalizeWhitespace(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .replace(/\t/g, '    ')
        .trim();
}

function collapseSearchText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function tokenize(text) {
    return Array.from(new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    ));
}

function countTokenOccurrences(text, token) {
    if (!text || !token) {
        return 0;
    }

    let count = 0;
    let fromIndex = 0;
    while (fromIndex >= 0) {
        const nextIndex = text.indexOf(token, fromIndex);
        if (nextIndex < 0) {
            return count;
        }

        count += 1;
        fromIndex = nextIndex + token.length;
    }

    return count;
}

function trimText(text, maxChars) {
    const value = String(text || '');
    if (value.length <= maxChars) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxChars - 21))}\n... [truncated]`;
}

async function runWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

async function loadRepoIndex() {
    if (!hasGameRepoConfig()) {
        return null;
    }

    const now = Date.now();
    if (
        cachedIndex &&
        now - cachedIndex.loadedAt < (Number.isFinite(REPO_REFRESH_MS) && REPO_REFRESH_MS > 0 ? REPO_REFRESH_MS : 900000)
    ) {
        return cachedIndex;
    }

    if (loadingIndexPromise) {
        return loadingIndexPromise;
    }

    loadingIndexPromise = (async () => {
        const branchPayload = await githubRequest(`/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/branches/${encodeURIComponent(REPO_BRANCH)}`);
        const headCommitSha = branchPayload && branchPayload.commit && branchPayload.commit.sha
            ? String(branchPayload.commit.sha)
            : '';

        if (cachedIndex && cachedIndex.headCommitSha === headCommitSha) {
            cachedIndex.loadedAt = now;
            return cachedIndex;
        }

        const gitCommitPayload = await githubRequest(`/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/git/commits/${encodeURIComponent(headCommitSha)}`);
        const treeSha = gitCommitPayload && gitCommitPayload.tree && gitCommitPayload.tree.sha
            ? String(gitCommitPayload.tree.sha)
            : '';

        if (!treeSha) {
            throw new Error('Could not resolve game repo tree SHA');
        }

        const treePayload = await githubRequest(`/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/git/trees/${encodeURIComponent(treeSha)}`, {
            recursive: 1
        });

        const treeItems = Array.isArray(treePayload && treePayload.tree) ? treePayload.tree : [];
        const allowedFiles = treeItems
            .filter((item) => item && item.type === 'blob' && isAllowedRepoPath(String(item.path || '')))
            .filter((item) => Number.isFinite(item.size) ? item.size <= MAX_INDEXED_FILE_SIZE_BYTES : true)
            .slice(0, Number.isFinite(MAX_INDEXED_FILES) && MAX_INDEXED_FILES > 0 ? MAX_INDEXED_FILES : 600);

        const indexedFiles = await runWithConcurrency(allowedFiles, async (item) => {
            const filePath = String(item.path || '');
            const contentPayload = await githubRequest(`/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/contents/${filePath}`, {
                ref: REPO_BRANCH
            });
            const content = normalizeWhitespace(decodeGitHubContent(contentPayload));
            const searchText = `${filePath}\n${content}`.toLowerCase();
            const collapsedSearchText = collapseSearchText(`${filePath}\n${content}`);

            return {
                path: filePath,
                pathLower: filePath.toLowerCase(),
                content,
                searchText,
                collapsedSearchText
            };
        }, 8);

        cachedIndex = {
            owner: REPO_OWNER,
            repo: REPO_NAME,
            branch: REPO_BRANCH,
            headCommitSha,
            loadedAt: Date.now(),
            files: indexedFiles.filter(Boolean)
        };

        return cachedIndex;
    })();

    try {
        return await loadingIndexPromise;
    } finally {
        loadingIndexPromise = null;
    }
}

function scoreFile(entry, queryTokens) {
    if (!entry || !queryTokens.length) {
        return 0;
    }

    let score = 0;
    for (const token of queryTokens) {
        if (entry.pathLower.includes(token)) {
            score += 12;
        }

        const matchCount = countTokenOccurrences(entry.searchText, token);
        score += Math.min(matchCount, 8) * 3;

        const collapsedToken = collapseSearchText(token);
        if (collapsedToken && collapsedToken !== token) {
            const collapsedMatchCount = countTokenOccurrences(entry.collapsedSearchText, collapsedToken);
            score += Math.min(collapsedMatchCount, 8) * 2;
        } else if (collapsedToken) {
            const collapsedMatchCount = countTokenOccurrences(entry.collapsedSearchText, collapsedToken);
            score += Math.min(collapsedMatchCount, 8);
        }
    }

    if (entry.pathLower.endsWith('/c.luau') || entry.pathLower.endsWith('default.project.json')) {
        score += 4;
    }

    return score;
}

function buildSnippets(entry, queryTokens) {
    const lines = String(entry && entry.content || '').split('\n');
    const windows = [];

    for (let index = 0; index < lines.length; index += 1) {
        const lineLower = lines[index].toLowerCase();
        let lineScore = 0;
        for (const token of queryTokens) {
            if (lineLower.includes(token)) {
                lineScore += 1;
            }
        }

        if (!lineScore) {
            continue;
        }

        const start = Math.max(0, index - 2);
        const end = Math.min(lines.length, index + 3);
        const snippetText = lines.slice(start, end).join('\n').trim();
        if (!snippetText) {
            continue;
        }

        windows.push({
            score: lineScore,
            text: snippetText
        });
    }

    if (!windows.length) {
        const fallback = lines.slice(0, 20).join('\n').trim();
        return fallback ? [fallback.slice(0, MAX_SNIPPET_CHARS)] : [];
    }

    return windows
        .sort((left, right) => right.score - left.score)
        .slice(0, 2)
        .map((window) => window.text.slice(0, MAX_SNIPPET_CHARS));
}

function describeSearchHit(entry, queryTokens) {
    const snippets = buildSnippets(entry, queryTokens);
    return {
        path: entry.path,
        preview: snippets.length ? snippets[0] : trimText(entry.content, 320)
    };
}

function buildQuestionText(historyMessages, requesterUserId) {
    const relevantMessages = historyMessages.filter((message) => (
        message &&
        message.author &&
        (!requesterUserId || message.author.id === requesterUserId)
    ));

    return relevantMessages
        .slice(-6)
        .map((message) => {
            const text = typeof message.cleanContent === 'string' ? message.cleanContent.trim() : '';
            return text || '';
        })
        .filter(Boolean)
        .join('\n');
}

async function getGameRepoContext(options) {
    if (!hasGameRepoConfig()) {
        return null;
    }

    const historyMessages = Array.isArray(options && options.historyMessages) ? options.historyMessages : [];
    const requesterUserId = options && options.requesterUserId ? String(options.requesterUserId) : null;
    const questionText = buildQuestionText(historyMessages, requesterUserId);
    const queryTokens = tokenize(questionText);

    if (!queryTokens.length) {
        return null;
    }

    const repoIndex = await loadRepoIndex();
    if (!repoIndex || !Array.isArray(repoIndex.files) || !repoIndex.files.length) {
        return null;
    }

    const candidates = repoIndex.files
        .map((entry) => ({
            entry,
            score: scoreFile(entry, queryTokens)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_SNIPPETS);

    if (!candidates.length) {
        return null;
    }

    const snippets = [];
    for (const candidate of candidates) {
        const excerptBlocks = buildSnippets(candidate.entry, queryTokens);
        if (!excerptBlocks.length) {
            continue;
        }

        snippets.push(
            `File: ${candidate.entry.path}\n${excerptBlocks.join('\n...\n')}`
        );
    }

    if (!snippets.length) {
        return null;
    }

    return {
        owner: repoIndex.owner,
        repo: repoIndex.repo,
        branch: repoIndex.branch,
        headCommitSha: repoIndex.headCommitSha,
        snippets
    };
}

async function searchRepo(query, limit) {
    const repoIndex = await loadRepoIndex();
    if (!repoIndex || !Array.isArray(repoIndex.files) || !repoIndex.files.length) {
        return {
            branch: REPO_BRANCH,
            results: []
        };
    }

    const queryTokens = tokenize(query);
    if (!queryTokens.length) {
        return {
            branch: repoIndex.branch,
            results: []
        };
    }

    const maxResults = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.trunc(limit), MAX_SEARCH_RESULTS)
        : MAX_SEARCH_RESULTS;

    const results = repoIndex.files
        .map((entry) => ({
            entry,
            score: scoreFile(entry, queryTokens)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, maxResults)
        .map((candidate) => ({
            score: candidate.score,
            ...describeSearchHit(candidate.entry, queryTokens)
        }));

    return {
        branch: repoIndex.branch,
        results
    };
}

async function listRepoPaths(prefix, limit) {
    const repoIndex = await loadRepoIndex();
    if (!repoIndex || !Array.isArray(repoIndex.files) || !repoIndex.files.length) {
        return {
            branch: REPO_BRANCH,
            paths: []
        };
    }

    const normalizedPrefix = String(prefix || '').trim().replace(/\\/g, '/').toLowerCase();
    const maxResults = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.trunc(limit), MAX_LIST_RESULTS)
        : MAX_LIST_RESULTS;

    const paths = repoIndex.files
        .map((entry) => entry.path)
        .filter((repoPath) => !normalizedPrefix || repoPath.toLowerCase().startsWith(normalizedPrefix))
        .sort((left, right) => left.localeCompare(right))
        .slice(0, maxResults);

    return {
        branch: repoIndex.branch,
        paths
    };
}

async function readRepoFile(repoPath) {
    const repoIndex = await loadRepoIndex();
    const entry = findIndexedFile(repoIndex, repoPath);
    if (!entry) {
        return {
            path: String(repoPath || ''),
            found: false
        };
    }

    const lines = entry.content.split('\n');
    return {
        path: entry.path,
        found: true,
        lineCount: lines.length,
        content: trimText(entry.content, MAX_READ_FILE_CHARS)
    };
}

async function readRepoFileChunk(repoPath, startLine, endLine) {
    const repoIndex = await loadRepoIndex();
    const entry = findIndexedFile(repoIndex, repoPath);
    if (!entry) {
        return {
            path: String(repoPath || ''),
            found: false
        };
    }

    const lines = entry.content.split('\n');
    const boundedStart = Math.max(1, Math.trunc(Number(startLine) || 1));
    const boundedEnd = Math.min(
        lines.length,
        Math.max(boundedStart, Math.trunc(Number(endLine) || boundedStart)),
        boundedStart + MAX_READ_CHUNK_LINES - 1
    );

    return {
        path: entry.path,
        found: true,
        startLine: boundedStart,
        endLine: boundedEnd,
        content: lines.slice(boundedStart - 1, boundedEnd).join('\n')
    };
}

module.exports = {
    getGameRepoSummary,
    getGameRepoContext,
    hasGameRepoConfig,
    listRepoPaths,
    loadRepoIndex,
    readRepoFile,
    readRepoFileChunk,
    searchRepo
};
