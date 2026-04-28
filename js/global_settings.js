// ============ Global Settings ============
// App-level defaults for chat/image/video models + enableImageCacheKey.
// API keys are managed by `sdk.localAPIKeySettings` (opened via a button
// inside the settings modal).

import { sdk } from './state.js';
import { CONFIG } from './config.js';

const APP_SETTINGS_KEY = 'aimm_app_settings';

const APP_DEFAULTS = {
    chatModel: 'keepwork-flash',
    imageModel: 'gpt-image-2',
    videoModel: 'seedance-2.0-fast',
    enableImageCacheKey: false,
    analysisProvider: 'keepwork',
    localApiBase: 'http://127.0.0.1:3001',
};

// ---- LocalAPIKeySettings init ----
const _localSettings = sdk.localAPIKeySettings;
//_localSettings.workspace = CONFIG.PROJECT_WORKSPACE;
//_localSettings.storageMode = 'personalPageStore';

/**
 * Initialize global settings. Must be awaited at app startup before any
 * module reads API keys or model defaults.
 */
export async function initGlobalSettings() {
    await _localSettings.load();
    loadAppSettings();
}

// ---- App-specific settings (localStorage only) ----
let _appSettings = null;

function loadAppSettings() {
    if (_appSettings) return _appSettings;
    try {
        const saved = localStorage.getItem(APP_SETTINGS_KEY);
        if (saved) {
            _appSettings = { ...APP_DEFAULTS, ...JSON.parse(saved) };
            return _appSettings;
        }
    } catch (_) { /* ignore */ }
    _appSettings = { ...APP_DEFAULTS };
    return _appSettings;
}

function saveAppSettings(settings) {
    _appSettings = { ...APP_DEFAULTS, ..._appSettings, ...settings };
    try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(_appSettings)); } catch (_) {}
}

function hasConfiguredApiKey(modelName) {
    const resolved = _localSettings.resolve(modelName);
    return !!resolved?.apiKey;
}

// ---- Public getters ----
export function getGlobalChatModel() { return loadAppSettings().chatModel || APP_DEFAULTS.chatModel; }
export function getGlobalImageModel() { return loadAppSettings().imageModel || ''; }
export function getGlobalVideoModel() { return loadAppSettings().videoModel || APP_DEFAULTS.videoModel; }

// Legacy alias: used by api.js for streaming LLM requests.
export function getGlobalLLM() { return getGlobalChatModel(); }

export function getGlobalLLMApiKey() {
    const resolved = _localSettings.resolve(getGlobalChatModel());
    return resolved?.apiKey || '';
}

export function getGlobalImageApiKey() {
    const imageModel = getGlobalImageModel();
    const resolved = _localSettings.resolve(imageModel === 'gpt-image-2' ? 'gpt-image-2' : (imageModel || 'keepwork-image'));
    return resolved?.apiKey || '';
}

export function getGlobalVideoApiKey() {
    const resolved = _localSettings.resolve(getGlobalVideoModel() || 'keepwork-video');
    return resolved?.apiKey || '';
}

export function getGlobalEnableImageCacheKey() {
    return !!loadAppSettings().enableImageCacheKey;
}

export function getGlobalAnalysisProvider() {
    return loadAppSettings().analysisProvider || APP_DEFAULTS.analysisProvider;
}

export function getGlobalLocalApiBase() {
    return loadAppSettings().localApiBase || APP_DEFAULTS.localApiBase;
}

// Kept for backward compat with api.js (which consults project-level
// promptPreset first). There is no longer a global UI for this.
export function getGlobalPromptPreset() {
    return 'zh';
}

// Legacy compat shims
export function loadGlobalSettings() {
    const app = loadAppSettings();
    return {
        chatModel: app.chatModel,
        imageModel: app.imageModel,
        videoModel: app.videoModel,
        enableImageCacheKey: app.enableImageCacheKey,
        analysisProvider: app.analysisProvider,
        localApiBase: app.localApiBase,
    };
}
export function saveGlobalSettings(settings) { saveAppSettings(settings); }

// ============ Settings Modal ============

const MODAL_ID = 'aimmGlobalSettingsModal';

function buildModelOptions(type) {
    try {
        const list = sdk?.aiGenerators?.getModels?.(type);
        if (Array.isArray(list) && list.length > 0) {
            const options = list.slice();
            if (type === 'image' && !options.includes('gpt-image-2')) options.unshift('gpt-image-2');
            return options;
        }
    } catch (_) { /* ignore */ }
    if (type === 'image') return ['gpt-image-2'];
    return [];
}

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildModelField(id, label, type, currentValue) {
    const options = buildModelOptions(type);
    const cur = currentValue || '';
    // Ensure current value appears in the option list
    const allOpts = (cur && !options.includes(cur)) ? [cur, ...options] : options;
    const optionsHtml = allOpts.map(v =>
        `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}${hasConfiguredApiKey(v) ? ' · 已配置' : ''}${v === cur ? ' · 当前使用' : ''}</option>`
    ).join('');
    return `
      <div class="gs-row">
        <label class="gs-label" for="${id}">${esc(label)}</label>
        <select id="${id}" class="gs-input gs-select">${optionsHtml}</select>
      </div>`;
}

function buildStatusCard(app) {
    const imageModel = app.imageModel || APP_DEFAULTS.imageModel;
    const chatModel = app.chatModel || APP_DEFAULTS.chatModel;
    const videoModel = app.videoModel || APP_DEFAULTS.videoModel;
    const imageProviderLabel = imageModel === 'gpt-image-2' ? '自定义接口' : 'Keepwork / SDK';
    const analysisProviderLabel = (app.analysisProvider || APP_DEFAULTS.analysisProvider) === 'local' ? '本地代理' : 'Keepwork 直连';
    return `
      <div class="gs-status-card">
        <div class="gs-status-head">当前通道状态</div>
        <div class="gs-status-grid">
          <div class="gs-status-item">
            <div class="gs-status-label">Chat</div>
            <div class="gs-status-main">${esc(chatModel)}</div>
            <div class="gs-status-sub">Keepwork</div>
          </div>
          <div class="gs-status-item gs-status-item-highlight">
            <div class="gs-status-label">Image</div>
            <div class="gs-status-main">${esc(imageModel)}</div>
            <div class="gs-status-sub">${esc(imageProviderLabel)} · ${hasConfiguredApiKey(imageModel) ? '已配置 Key' : '未配置 Key'}</div>
          </div>
          <div class="gs-status-item">
            <div class="gs-status-label">Video</div>
            <div class="gs-status-main">${esc(videoModel)}</div>
            <div class="gs-status-sub">Keepwork</div>
          </div>
          <div class="gs-status-item">
            <div class="gs-status-label">Analysis</div>
            <div class="gs-status-main">${esc(analysisProviderLabel)}</div>
            <div class="gs-status-sub">${esc(app.localApiBase || APP_DEFAULTS.localApiBase)}</div>
          </div>
        </div>
      </div>`;
}

function buildQuickModelButtons(currentImageModel) {
    const presets = ['gpt-image-2', 'seedream-5.0-lite', 'seedream-4.5'];
    return presets.map(model => `
      <button type="button" class="gs-chip${model === currentImageModel ? ' active' : ''}" data-gs-image-preset="${esc(model)}">
        ${esc(model)}
        ${hasConfiguredApiKey(model) ? '<span class="gs-chip-tag">已配置</span>' : ''}
      </button>
    `).join('');
}

function ensureStyles() {
    if (document.getElementById('aimmGlobalSettingsStyle')) return;
    const style = document.createElement('style');
    style.id = 'aimmGlobalSettingsStyle';
    style.textContent = `
      .gs-overlay { position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center; }
      .gs-box { background: #1e1e2e; color: #e0e0e0; border-radius: 12px; width: 480px;
        max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,.5); overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      body.light .gs-box { background: #fff; color: #222; }
      .gs-head { display: flex; align-items: center; padding: 14px 18px;
        border-bottom: 1px solid #2d2d3d; }
      body.light .gs-head { border-color: #eee; }
      .gs-title { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
      .gs-close { background: none; border: none; color: #888; font-size: 22px;
        cursor: pointer; line-height: 1; padding: 0 4px; }
      .gs-close:hover { color: #fff; }
      body.light .gs-close:hover { color: #000; }
      .gs-body { padding: 16px 18px; }
      .gs-row { margin-bottom: 14px; }
      .gs-status-card { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 10px; padding: 12px; margin-bottom: 16px; }
      .gs-status-head { font-size: 12px; color: #a5b4fc; font-weight: 700; margin-bottom: 10px; }
      .gs-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .gs-status-item { background: rgba(0,0,0,0.18); border: 1px solid #2d2d3d; border-radius: 8px; padding: 10px; }
      .gs-status-item-highlight { border-color: rgba(99,102,241,0.45); box-shadow: inset 0 0 0 1px rgba(99,102,241,0.18); }
      .gs-status-label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #888; margin-bottom: 4px; }
      .gs-status-main { font-size: 13px; font-weight: 700; color: #e8e8f8; }
      .gs-status-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }
      body.light .gs-status-card { background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.16); }
      body.light .gs-status-item { background: #fff; border-color: #e5e7eb; }
      body.light .gs-status-main { color: #222; }
      .gs-label { display: block; font-size: 11px; color: #888; text-transform: uppercase;
        letter-spacing: .5px; margin-bottom: 4px; }
      .gs-input { width: 100%; box-sizing: border-box; background: #2a2a3a;
        border: 1px solid #3a3a4a; border-radius: 6px; padding: 8px 12px;
        color: #e0e0e0; font-size: 13px; }
      body.light .gs-input { background: #f5f5f7; border-color: #ddd; color: #222; }
      .gs-input:focus { outline: none; border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99,102,241,.25); }
      .gs-select { appearance: auto; cursor: pointer; }
      .gs-checkbox { display: flex; align-items: center; gap: 8px; font-size: 13px;
        color: #ccc; cursor: pointer; }
      body.light .gs-checkbox { color: #444; }
      .gs-foot { display: flex; gap: 8px; padding: 12px 18px; border-top: 1px solid #2d2d3d; }
      body.light .gs-foot { border-color: #eee; }
      .gs-btn { border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px;
        cursor: pointer; transition: background .15s; }
      .gs-btn-primary { background: #6366f1; color: #fff; }
      .gs-btn-primary:hover { background: #5558e6; }
      .gs-btn-secondary { background: #333; color: #ccc; }
      .gs-btn-secondary:hover { background: #444; }
      body.light .gs-btn-secondary { background: #eee; color: #333; }
      body.light .gs-btn-secondary:hover { background: #ddd; }
      .gs-spacer { flex: 1; }
      .gs-hint { font-size: 11px; color: #666; margin-top: 4px; }
      .gs-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .gs-chip { border: 1px solid #3a3a4a; background: #2a2a3a; color: #d1d5db; border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .gs-chip:hover { border-color: #6366f1; color: #c7d2fe; }
      .gs-chip.active { background: rgba(99,102,241,0.16); border-color: #6366f1; color: #c7d2fe; }
      .gs-chip-tag { font-size: 10px; color: #6ee7b7; }
      body.light .gs-chip { background: #f5f5f7; border-color: #ddd; color: #333; }
    `;
    document.head.appendChild(style);
}

function readValues(overlay) {
    return {
        chatModel: overlay.querySelector('#gsChatModel').value.trim(),
        imageModel: overlay.querySelector('#gsImageModel').value.trim(),
        videoModel: overlay.querySelector('#gsVideoModel').value.trim(),
        enableImageCacheKey: overlay.querySelector('#gsCacheKey').checked,
        analysisProvider: overlay.querySelector('#gsAnalysisProvider').value.trim(),
        localApiBase: overlay.querySelector('#gsLocalApiBase').value.trim(),
    };
}

function buildSelectField(id, label, currentValue, options) {
    const optionsHtml = options.map(option =>
        `<option value="${esc(option.value)}"${option.value === currentValue ? ' selected' : ''}>${esc(option.label)}</option>`
    ).join('');
    return `
      <div class="gs-row">
        <label class="gs-label" for="${id}">${esc(label)}</label>
        <select id="${id}" class="gs-input gs-select">${optionsHtml}</select>
      </div>`;
}

export function showSettingsModal() {
    ensureStyles();
    hideSettingsModal();
    const app = loadAppSettings();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'gs-overlay';
    overlay.innerHTML = `
      <div class="gs-box" role="dialog" aria-label="全局设置">
        <div class="gs-head">
          <h3 class="gs-title">全局设置</h3>
          <button class="gs-close" data-gs-close>&times;</button>
        </div>
        <div class="gs-body">
          ${buildStatusCard(app)}
          ${buildModelField('gsChatModel', '聊天模型 (Chat)', 'chat', app.chatModel)}
          ${buildModelField('gsImageModel', '图像模型 (Image)', 'image', app.imageModel)}
          <div class="gs-hint">图片默认建议走自定义接口，其他能力继续使用 Keepwork。</div>
          <div class="gs-chip-row">
            ${buildQuickModelButtons(app.imageModel)}
          </div>
          ${buildModelField('gsVideoModel', '视频模型 (Video)', 'video', app.videoModel)}
          ${buildSelectField('gsAnalysisProvider', '剧本分析接口', app.analysisProvider || APP_DEFAULTS.analysisProvider, [
              { value: 'keepwork', label: 'Keepwork 直连' },
              { value: 'local', label: '本地接口代理' },
          ])}
          <div class="gs-row">
            <label class="gs-label" for="gsLocalApiBase">本地 API 地址</label>
            <input id="gsLocalApiBase" class="gs-input" value="${esc(app.localApiBase || APP_DEFAULTS.localApiBase)}" placeholder="http://127.0.0.1:3001" />
            <div class="gs-hint">仅在“剧本分析接口”选为“本地接口代理”时使用</div>
          </div>
          <div class="gs-row">
            <label class="gs-checkbox">
              <input type="checkbox" id="gsEnableLocalAPI" ${_localSettings.enabled ? 'checked' : ''} />
              <span>启用本地 API Key</span>
            </label>
          </div>
          <div class="gs-row">
            <button class="gs-btn gs-btn-secondary" data-gs-open-api>🔑 配置 API Key…</button>
            <div class="gs-hint">管理各服务商的本地 API Key 与模型映射。若图片走 <code>gpt-image-2</code>，请确保已在此处给 <code>gpt-image-2</code> 配置 key。</div>
          </div>
          <div class="gs-row">
            <label class="gs-checkbox">
              <input type="checkbox" id="gsCacheKey" ${app.enableImageCacheKey ? 'checked' : ''} />
              <span>启用图像缓存 key</span>
            </label>
          </div>
        </div>
        <div class="gs-foot">
          <span class="gs-spacer"></span>
          <button class="gs-btn gs-btn-secondary" data-gs-close>取消</button>
          <button class="gs-btn gs-btn-primary" data-gs-save>保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideSettingsModal();
    });
    overlay.querySelectorAll('[data-gs-close]').forEach(btn => {
        btn.addEventListener('click', () => hideSettingsModal());
    });
    overlay.querySelectorAll('[data-gs-image-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const model = btn.getAttribute('data-gs-image-preset') || '';
            const select = overlay.querySelector('#gsImageModel');
            if (!select) return;
            const exists = Array.from(select.options).some(option => option.value === model);
            if (!exists) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                select.appendChild(option);
            }
            select.value = model;
            overlay.querySelectorAll('[data-gs-image-preset]').forEach(chip => chip.classList.toggle('active', chip.getAttribute('data-gs-image-preset') === model));
        });
    });
    overlay.querySelector('#gsEnableLocalAPI').addEventListener('change', (e) => {
        _localSettings.enabled = e.target.checked;
        _localSettings.save();
    });
    overlay.querySelector('[data-gs-open-api]').addEventListener('click', () => {
        _localSettings.show({
            onClose: () => {
                const cb = overlay.querySelector('#gsEnableLocalAPI');
                if (cb) cb.checked = !!_localSettings.enabled;
            },
        });
    });
    overlay.querySelector('[data-gs-save]').addEventListener('click', () => {
        saveAppSettings(readValues(overlay));
        hideSettingsModal();
    });
}

export function hideSettingsModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
}
