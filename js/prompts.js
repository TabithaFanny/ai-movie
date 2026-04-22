// ============ Versioned Prompt Registry ============
//
// Built-in presets live as markdown files under
//   AIMovieMakerWorkspace/prompts/<FILE>.md
// and are loaded via PersonalPageStore.addSearchPath + readFile.
//
// User presets live under workspace 'AIMovieMaker' in the 'prompts/' folder
// (PersonalPageStore format, synced to keepwork).
//
// Each preset file may start with optional metadata lines (before the first
// '# taskName' heading):
//   label: Display Label
//   lang:  zh | en | ...
//   base:  <presetKey>    (optional — inherit tasks from another preset)
//
// Followed by one or more task sections:
//   # taskName
//   <prompt body>
//
// Use getPrompt(taskName, presetKey) to resolve a prompt template (sync).
// Call `await initBuiltinPresets()` once at app boot — this now only loads the
// default 'zh' preset (used as a fallback by getPrompt). Other presets are
// loaded lazily on first use; callers that want to use a non-default preset
// must `await ensurePresetLoaded(presetKey)` before calling getPrompt(..., key).

// ==================== Built-in Preset Registry ====================

// Metadata only — actual prompts are loaded from markdown files on demand.
export const PROMPT_PRESETS = {
    'zh':                  { label: '中文默认',                   lang: 'zh', file: 'ZH_default.md' },
    'zh-interactive':      { label: '互动电影（分支剧情）',         lang: 'zh', file: 'ZH_interactive.md',      base: 'zh' },
    'zh-long-interactive': { label: '长互动电影（多幕+嵌套分支）',   lang: 'zh', file: 'ZH_long_interactive.md', base: 'zh' },
    'en':                  { label: 'English默认',                lang: 'en', file: 'EN_default.md' },
    'zh-picturebook':      { label: '绘本故事',                   lang: 'zh', file: 'ZH_picturebook.md',      base: 'zh' },
    'zh-shortdrama':       { label: '短剧',                      lang: 'zh', file: 'ZH_shortdrama.md',       base: 'zh' },
    'zh-ad':               { label: '广告',                      lang: 'zh', file: 'ZH_ad.md',               base: 'zh' },
};

const BUILTIN_SEARCH_PREFIX = 'AIMovieMaker/prompts';
const BUILTIN_BASE_URL = 'AIMovieMakerWorkspace/prompts/';

const _builtinCache = {};     // presetKey -> { label, lang, prompts: { taskName: body } }
let _searchPathRegistered = false;
let _initPromise = null;

// ==================== Storage helpers ====================

function _getWorkspaceStore() {
    const sdk = window.keepwork;
    if (!sdk?.personalPageStore) return null;
    return sdk.personalPageStore.withWorkspace('AIMovieMaker');
}

function _ensureSearchPath(store) {
    if (_searchPathRegistered) return;
    try {
        store.addSearchPath(BUILTIN_SEARCH_PREFIX, BUILTIN_BASE_URL, { isReadonly: true });
        _searchPathRegistered = true;
    } catch (e) {
        console.warn('[prompts] addSearchPath failed:', e);
    }
}

// ==================== Markdown parser / serializer ====================

/**
 * Parse a markdown preset file into { label, lang, base, prompts }.
 * Optional YAML-style metadata at the top (before the first '# taskName' heading):
 *   label: My Preset
 *   lang:  zh
 *   base:  zh
 * Followed by sections:
 *   # taskName
 *   <body lines>
 */
function _parsePresetMarkdown(raw) {
    const lines = String(raw).split(/\r?\n/);
    const prompts = {};
    const meta = { label: '', lang: 'zh', base: '' };
    let currentTask = null;
    let currentLines = [];

    const flushTask = () => {
        if (currentTask) {
            prompts[currentTask] = currentLines.join('\n').trim();
        }
        currentLines = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^#\s+(\S+)\s*$/);
        if (headingMatch) {
            flushTask();
            currentTask = headingMatch[1];
            continue;
        }
        if (!currentTask) {
            // Before first heading: parse optional metadata
            const metaMatch = line.match(/^(\w+)\s*[:：]\s*(.+)$/);
            if (metaMatch) {
                const k = metaMatch[1].toLowerCase();
                meta[k] = metaMatch[2].trim();
            }
            continue;
        }
        currentLines.push(line);
    }
    flushTask();
    return { ...meta, prompts };
}

/**
 * Serialize a preset to markdown format.
 * @param {{ label?: string, lang?: string, base?: string, prompts: Object }} data
 */
function _serializePresetMarkdown(data) {
    const lines = [];
    if (data.label) lines.push(`label: ${data.label}`);
    if (data.lang) lines.push(`lang: ${data.lang}`);
    if (data.base) lines.push(`base: ${data.base}`);
    if (lines.length) lines.push('');
    for (const [taskName, promptText] of Object.entries(data.prompts || {})) {
        lines.push(`# ${taskName}`);
        lines.push(String(promptText));
        lines.push('');
    }
    return lines.join('\n');
}

// ==================== Built-in loading ====================

/**
 * Load a single built-in preset from its markdown file.
 * Resolves `base` inheritance by merging the base preset's prompts underneath.
 */
async function _loadBuiltinPreset(key, visited = new Set()) {
    if (_builtinCache[key]) return _builtinCache[key];
    if (visited.has(key)) {
        console.warn(`[prompts] Circular base reference detected for preset "${key}"`);
        return null;
    }
    visited.add(key);

    const metaInfo = PROMPT_PRESETS[key];
    if (!metaInfo) return null;

    const store = _getWorkspaceStore();
    if (!store) {
        console.warn('[prompts] Keepwork SDK not ready; cannot load built-in presets.');
        return null;
    }
    _ensureSearchPath(store);

    let parsed;
    try {
        const raw = await store.readFile(`prompts/${metaInfo.file}`);
        parsed = _parsePresetMarkdown(raw);
    } catch (e) {
        console.warn(`[prompts] Failed to load built-in preset "${key}" from ${metaInfo.file}:`, e);
        return null;
    }

    let prompts = parsed.prompts || {};
    const baseKey = metaInfo.base || parsed.base;
    if (baseKey && baseKey !== key) {
        const baseData = await _loadBuiltinPreset(baseKey, visited);
        if (baseData?.prompts) {
            prompts = { ...baseData.prompts, ...prompts };
        }
    }

    const result = {
        label: parsed.label || metaInfo.label,
        lang: parsed.lang || metaInfo.lang,
        prompts,
    };
    _builtinCache[key] = result;
    return result;
}

/**
 * Initialize the default built-in preset ('zh') used as the universal
 * fallback in getPrompt(). Other built-in presets are loaded lazily via
 * `ensurePresetLoaded(presetKey)` on first use. Safe to call multiple times —
 * subsequent invocations return the same in-flight promise.
 */
export function initBuiltinPresets() {
    if (_initPromise) return _initPromise;
    _initPromise = _loadBuiltinPreset('zh');
    return _initPromise;
}

/**
 * Ensure a preset (built-in or user) is loaded into the cache. Callers that
 * intend to use a non-default preset with the synchronous `getPrompt()` must
 * `await ensurePresetLoaded(presetKey)` first. No-op for falsy keys or the
 * already-loaded 'zh' default.
 */
export async function ensurePresetLoaded(presetKey) {
    if (!presetKey) return;
    if (presetKey.startsWith('user:')) {
        // User-preset cache covers all user presets in one listDir call.
        if (!_userPresetCache) await loadUserPresets();
        return;
    }
    if (_builtinCache[presetKey]) return;
    if (PROMPT_PRESETS[presetKey]) {
        await _loadBuiltinPreset(presetKey);
    }
}

// ==================== User Custom Presets (workspace storage) ====================

const USER_PROMPT_DIR = 'prompts';
let _userPresetCache = null; // { timestamp, presets: { key: { label, lang, prompts } } }
const USER_CACHE_TTL = 10000; // 10s

/**
 * List user-defined prompt presets from workspace prompts/ directory.
 * Returns { key: { label, lang, prompts } }.
 * User preset files are distinguished from built-ins by filename: any file
 * not matching a built-in `file` field is treated as a user preset.
 */
export async function loadUserPresets(forceRefresh = false) {
    if (!forceRefresh && _userPresetCache && (Date.now() - _userPresetCache.timestamp < USER_CACHE_TTL)) {
        return _userPresetCache.presets;
    }
    const store = _getWorkspaceStore();
    if (!store) return {};
    const builtinFiles = new Set(Object.values(PROMPT_PRESETS).map(p => p.file));
    try {
        const listing = await store.listDir(USER_PROMPT_DIR);
        const files = String(listing).split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && l.endsWith('.md') && !l.endsWith('/') && !builtinFiles.has(l));
        const presets = {};
        await Promise.all(files.map(async (fileName) => {
            try {
                const raw = await store.readFile(`${USER_PROMPT_DIR}/${fileName}`);
                const parsed = _parsePresetMarkdown(raw);
                const stem = fileName.replace(/\.md$/, '');
                const key = 'user:' + stem;
                presets[key] = {
                    label: parsed.label || stem,
                    lang: parsed.lang || 'zh',
                    prompts: parsed.prompts || {},
                    isUser: true,
                };
            } catch (e) {
                console.warn(`[AIMM] Failed to parse user preset ${fileName}:`, e);
            }
        }));
        _userPresetCache = { timestamp: Date.now(), presets };
        return presets;
    } catch (e) {
        // Directory may not exist yet
        _userPresetCache = { timestamp: Date.now(), presets: {} };
        return {};
    }
}

/**
 * Save a user-defined prompt preset to workspace prompts/<name>.md.
 * @param {string} name - preset file name (without extension)
 * @param {{ label?: string, lang?: string, prompts: Object }} data
 */
export async function saveUserPreset(name, data) {
    const store = _getWorkspaceStore();
    if (!store) throw new Error('Storage not available');
    const safeName = String(name).replace(/[\\/:*?"<>|]/g, '-').trim();
    if (!safeName) throw new Error('Invalid preset name');
    const filePath = `${USER_PROMPT_DIR}/${safeName}.md`;
    await store.createFile(filePath, _serializePresetMarkdown(data));
    _userPresetCache = null; // invalidate cache
    return 'user:' + safeName;
}

/**
 * Delete a user-defined prompt preset.
 */
export async function deleteUserPreset(key) {
    if (!key.startsWith('user:')) return;
    const store = _getWorkspaceStore();
    if (!store) return;
    const safeName = key.slice(5);
    const filePath = `${USER_PROMPT_DIR}/${safeName}.md`;
    try { await store.createFile(filePath, ''); } catch (e) { /* best effort */ }
    _userPresetCache = null;
}

// ==================== Public lookup API ====================

/**
 * Get a prompt template by task name and preset key. Synchronous.
 * Falls back through: requested preset → 'zh' built-in → empty string.
 * NOTE: `initBuiltinPresets()` must be awaited at app startup before this is called.
 */
export function getPrompt(taskName, presetKey = 'zh') {
    // Check built-in presets (from cache)
    const preset = _builtinCache[presetKey];
    if (preset && preset.prompts[taskName]) return preset.prompts[taskName];
    // Check user presets from cache
    if (presetKey.startsWith('user:') && _userPresetCache?.presets[presetKey]) {
        const userPrompt = _userPresetCache.presets[presetKey].prompts[taskName];
        if (userPrompt) return userPrompt;
    }
    // Fall back to 'zh' default
    const zh = _builtinCache['zh'];
    if (zh?.prompts[taskName]) return zh.prompts[taskName];
    if (!_initPromise) {
        console.warn('[prompts] getPrompt called before initBuiltinPresets(); returning empty string.');
    }
    return '';
}

/**
 * Get all prompt task names (from the 'zh' built-in preset).
 */
export function getPromptTaskNames() {
    const zh = _builtinCache['zh'];
    return zh ? Object.keys(zh.prompts) : [];
}

/**
 * Get available built-in preset keys and labels for UI.
 */
export function getPromptPresetOptions() {
    return Object.entries(PROMPT_PRESETS).map(([key, val]) => ({ value: key, label: val.label }));
}

/**
 * Get all preset options including user-defined ones (async).
 * Returns [...builtinOptions, ...userOptions].
 */
export async function getAllPromptPresetOptions() {
    const builtins = getPromptPresetOptions();
    const userPresets = await loadUserPresets();
    const userOpts = Object.entries(userPresets).map(([key, val]) => ({ value: key, label: `📝 ${val.label}`, isUser: true }));
    return [...builtins, ...userOpts];
}

/**
 * Get a full preset object (built-in or user) by key. Sync from cache.
 */
export function getPresetByKey(key) {
    if (_builtinCache[key]) return _builtinCache[key];
    if (key.startsWith('user:') && _userPresetCache?.presets[key]) return _userPresetCache.presets[key];
    return null;
}

// Backward-compatible flat PROMPTS proxy (defaults to Chinese, lazy-reads cache)
export const PROMPTS = new Proxy({}, {
    get(_target, prop) {
        const zh = _builtinCache['zh'];
        return zh?.prompts?.[prop];
    },
    has(_target, prop) {
        const zh = _builtinCache['zh'];
        return !!(zh && prop in zh.prompts);
    },
    ownKeys() {
        const zh = _builtinCache['zh'];
        return zh ? Object.keys(zh.prompts) : [];
    },
    getOwnPropertyDescriptor(_target, prop) {
        const zh = _builtinCache['zh'];
        if (zh && prop in zh.prompts) {
            return { enumerable: true, configurable: true, value: zh.prompts[prop] };
        }
        return undefined;
    },
});

