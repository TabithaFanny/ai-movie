// ============ Prompts Editor ============
// Full-screen modal editor for viewing/editing built-in and user-defined prompt presets.
// User presets are stored as markdown files in [workspace]/prompts/<name>.md

import { getPromptPresetOptions, getAllPromptPresetOptions, getPresetByKey, getPromptTaskNames, saveUserPreset, deleteUserPreset, loadUserPresets, ensurePresetLoaded } from './prompts.js';
import { escapeHtml, $, showToast } from './utils.js';

const MODAL_ID = 'promptsEditorModal';

let _onSaveCallback = null;

function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;max-width:1200px;margin:0 auto;padding:16px">
            <div class="card-flat fade-in" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:0">
                <!-- Header -->
                <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border-card);flex-shrink:0">
                    <span style="font-size:15px;font-weight:700;color:var(--text-primary);flex:1">📝 提示词编辑器</span>
                    <select id="pePresetSelect" class="modal-input" style="width:200px;font-size:12px;padding:5px 8px"></select>
                    <button id="peNewBtn" class="btn-secondary text-xs" style="padding:4px 10px">＋ 新建</button>
                    <button id="peDeleteBtn" class="btn-secondary text-xs" style="padding:4px 10px;display:none">🗑 删除</button>
                    <button id="peSaveBtn" class="btn-primary text-xs" style="padding:5px 14px">💾 保存</button>
                    <button id="peCloseBtn" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1">&times;</button>
                </div>

                <!-- Body: sidebar + editor -->
                <div style="display:flex;flex:1;min-height:0;overflow:hidden">
                    <!-- Task list sidebar -->
                    <div id="peTaskList" style="width:200px;flex-shrink:0;border-right:1px solid var(--border-card);overflow-y:auto;padding:8px 0"></div>

                    <!-- Editor area -->
                    <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden">
                        <div style="padding:8px 14px 4px;flex-shrink:0">
                            <div id="peTaskTitle" style="font-size:13px;font-weight:600;color:var(--text-primary)"></div>
                            <div id="peTaskHint" style="font-size:11px;color:var(--text-faint);margin-top:2px"></div>
                        </div>
                        <div style="flex:1;min-height:0;padding:0 14px 14px">
                            <textarea id="peEditor" style="width:100%;height:100%;resize:none;background:var(--input-bg);color:var(--text-primary);border:1px solid var(--border-card);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.6;font-family:'Cascadia Code','Fira Code',Consolas,monospace;tab-size:4" spellcheck="false"></textarea>
                        </div>
                    </div>
                </div>

                <!-- Footer info -->
                <div style="padding:6px 18px;border-top:1px solid var(--border-card);font-size:11px;color:var(--text-faint);flex-shrink:0">
                    <span id="peFooterInfo">内置模板（只读） · 点击"新建"创建可编辑的自定义模板</span>
                </div>
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.body.appendChild(modal);

    // Close button
    modal.querySelector('#peCloseBtn').onclick = close;

    // Preset select change
    modal.querySelector('#pePresetSelect').onchange = () => loadPreset(modal.querySelector('#pePresetSelect').value);

    // New button
    modal.querySelector('#peNewBtn').onclick = onNew;

    // Delete button
    modal.querySelector('#peDeleteBtn').onclick = onDelete;

    // Save button
    modal.querySelector('#peSaveBtn').onclick = onSave;

    return modal;
}

// ============ State ============
let _currentPresetKey = 'zh';
let _currentPreset = null; // { label, lang, prompts, isUser? }
let _editedPrompts = {};   // working copy of prompts
let _selectedTask = null;
let _dirty = false;

async function loadPreset(key) {
    // Save current task text before switching
    flushEditorToState();

    _currentPresetKey = key;
    // Lazy-load the preset (built-in or user) into cache before reading it.
    try { await ensurePresetLoaded(key); } catch (e) { console.warn('[promptsEditor] ensurePresetLoaded failed:', e); }
    _currentPreset = getPresetByKey(key);
    _editedPrompts = _currentPreset ? { ...(_currentPreset.prompts || {}) } : {};
    _dirty = false;
    _selectedTask = null;

    renderTaskList();
    renderEditor();
    updateUI();
}

function flushEditorToState() {
    if (_selectedTask && _currentPreset) {
        const editor = document.getElementById('peEditor');
        if (editor) {
            const newVal = editor.value;
            if (_editedPrompts[_selectedTask] !== newVal) {
                _editedPrompts[_selectedTask] = newVal;
                _dirty = true;
            }
        }
    }
}

function renderTaskList() {
    const container = document.getElementById('peTaskList');
    if (!container) return;

    const allTasks = getPromptTaskNames();
    // Also include tasks that exist in _editedPrompts but not in the standard list
    const extraTasks = Object.keys(_editedPrompts).filter(t => !allTasks.includes(t));
    const tasks = [...allTasks, ...extraTasks];

    container.innerHTML = tasks.map(task => {
        const hasContent = !!_editedPrompts[task];
        const isSelected = task === _selectedTask;
        return `<div class="pe-task-item ${isSelected ? 'pe-task-selected' : ''} ${!hasContent ? 'pe-task-empty' : ''}" data-task="${escapeHtml(task)}" title="${escapeHtml(task)}">
            <span class="pe-task-dot ${hasContent ? 'pe-task-dot-on' : ''}"></span>
            <span class="pe-task-name">${escapeHtml(task)}</span>
        </div>`;
    }).join('');

    container.querySelectorAll('.pe-task-item').forEach(el => {
        el.onclick = () => selectTask(el.getAttribute('data-task'));
    });

    // Auto-select first task if none selected
    if (!_selectedTask && tasks.length) selectTask(tasks[0]);
}

function selectTask(task) {
    flushEditorToState();
    _selectedTask = task;

    // Update sidebar selection
    document.querySelectorAll('.pe-task-item').forEach(el => {
        el.classList.toggle('pe-task-selected', el.getAttribute('data-task') === task);
    });

    renderEditor();
}

function renderEditor() {
    const editor = document.getElementById('peEditor');
    const title = document.getElementById('peTaskTitle');
    const hint = document.getElementById('peTaskHint');
    if (!editor || !title) return;

    const isUser = _currentPreset?.isUser;

    if (!_selectedTask) {
        title.textContent = '请选择一个提示词任务';
        hint.textContent = '';
        editor.value = '';
        editor.disabled = true;
        return;
    }

    title.textContent = _selectedTask;
    hint.textContent = isUser ? '可编辑 · 修改后点击"保存"' : '内置模板（只读）· 新建自定义模板后可编辑';
    editor.value = _editedPrompts[_selectedTask] || '';
    editor.disabled = !isUser;
    editor.style.opacity = isUser ? '1' : '0.7';
}

function updateUI() {
    const isUser = _currentPreset?.isUser;
    const deleteBtn = document.getElementById('peDeleteBtn');
    const saveBtn = document.getElementById('peSaveBtn');
    const footer = document.getElementById('peFooterInfo');

    if (deleteBtn) deleteBtn.style.display = isUser ? '' : 'none';
    if (saveBtn) saveBtn.style.display = isUser ? '' : 'none';
    if (footer) {
        if (isUser) {
            footer.textContent = `自定义模板: ${_currentPreset.label} · 存储于 prompts/${_currentPresetKey.slice(5)}.md`;
        } else {
            footer.textContent = '内置模板（只读） · 点击"新建"创建可编辑的自定义模板';
        }
    }
}

async function refreshPresetSelect(selectKey) {
    const select = document.getElementById('pePresetSelect');
    if (!select) return;

    const allOpts = await getAllPromptPresetOptions();
    select.innerHTML = allOpts.map(o =>
        `<option value="${escapeHtml(o.value)}" ${o.value === selectKey ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
}

// ============ Actions ============

async function onNew() {
    flushEditorToState();

    // Ask user to pick template source + name
    const picked = await pickTemplateDialog(_currentPresetKey);
    if (!picked) return;
    const { templateKey, name } = picked;

    try { await ensurePresetLoaded(templateKey); } catch (e) { console.warn('[promptsEditor] ensurePresetLoaded failed:', e); }
    const templatePreset = getPresetByKey(templateKey);
    // Clone prompts from chosen template (not from in-memory edits of another preset)
    const clonedPrompts = templatePreset ? { ...(templatePreset.prompts || {}) } : {};

    try {
        const data = {
            label: name,
            lang: templatePreset?.lang || 'zh',
            prompts: clonedPrompts,
        };
        const newKey = await saveUserPreset(name, data);
        showToast(`已创建: ${name}`, 'success');

        // Refresh and switch to new preset
        await loadUserPresets(true);
        await refreshPresetSelect(newKey);
        await loadPreset(newKey);

        if (_onSaveCallback) _onSaveCallback(newKey);
    } catch (e) {
        showToast(`创建失败: ${e.message}`, 'error');
    }
}

/**
 * Show a small modal to pick a template preset and enter a new name.
 * @param {string} defaultKey - preset key selected by default
 * @returns {Promise<{templateKey:string, name:string}|null>}
 */
async function pickTemplateDialog(defaultKey) {
    const allOpts = await getAllPromptPresetOptions();
    if (!allOpts.length) return null;

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center';
        const initialKey = allOpts.find(o => o.value === defaultKey) ? defaultKey : allOpts[0].value;
        const initialLabel = allOpts.find(o => o.value === initialKey)?.label || '';
        const defaultName = initialLabel ? `${initialLabel}-自定义` : '自定义模板';

        overlay.innerHTML = `
            <div class="card-flat fade-in" style="width:420px;max-width:92vw;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
                <div style="font-size:14px;font-weight:700;color:var(--text-primary)">新建提示词模板</div>
                <div style="display:flex;flex-direction:column;gap:4px">
                    <label style="font-size:11px;color:var(--text-faint)">从以下模板克隆：</label>
                    <select id="peNewTemplate" class="modal-input" style="font-size:12px;padding:6px 8px">
                        ${allOpts.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === initialKey ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px">
                    <label style="font-size:11px;color:var(--text-faint)">新模板名称：</label>
                    <input id="peNewName" type="text" class="modal-input" style="font-size:12px;padding:6px 8px" value="${escapeHtml(defaultName)}" />
                </div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
                    <button id="peNewCancel" class="btn-secondary text-xs" style="padding:5px 14px">取消</button>
                    <button id="peNewOk" class="btn-primary text-xs" style="padding:5px 14px">创建</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = overlay.querySelector('#peNewTemplate');
        const nameEl = overlay.querySelector('#peNewName');

        // Auto-update name placeholder when template changes (only if user hasn't customized)
        let nameDirty = false;
        nameEl.addEventListener('input', () => { nameDirty = true; });
        selectEl.addEventListener('change', () => {
            if (nameDirty) return;
            const lbl = allOpts.find(o => o.value === selectEl.value)?.label || '';
            nameEl.value = lbl ? `${lbl}-自定义` : '自定义模板';
        });

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
        overlay.querySelector('#peNewCancel').onclick = () => cleanup(null);
        overlay.querySelector('#peNewOk').onclick = () => {
            const name = (nameEl.value || '').trim();
            if (!name) { nameEl.focus(); return; }
            cleanup({ templateKey: selectEl.value, name });
        };
        nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('#peNewOk').click();
            else if (e.key === 'Escape') cleanup(null);
        });

        setTimeout(() => nameEl.select(), 50);
    });
}

async function onDelete() {
    if (!_currentPresetKey.startsWith('user:')) return;
    if (!confirm(`确定删除模板 "${_currentPreset?.label || _currentPresetKey}"？`)) return;

    try {
        await deleteUserPreset(_currentPresetKey);
        showToast('已删除', 'success');
        await loadUserPresets(true);
        await refreshPresetSelect('zh');
        await loadPreset('zh');
        if (_onSaveCallback) _onSaveCallback(null);
    } catch (e) {
        showToast(`删除失败: ${e.message}`, 'error');
    }
}

async function onSave() {
    if (!_currentPresetKey.startsWith('user:')) {
        showToast('内置模板不可修改，请先新建自定义模板', 'error');
        return;
    }
    flushEditorToState();

    try {
        const data = {
            label: _currentPreset?.label || _currentPresetKey.slice(5),
            lang: _currentPreset?.lang || 'zh',
            prompts: { ..._editedPrompts },
        };
        await saveUserPreset(_currentPresetKey.slice(5), data);
        _dirty = false;
        showToast('已保存', 'success');

        // Reload to refresh cache
        await loadUserPresets(true);
        _currentPreset = getPresetByKey(_currentPresetKey);

        if (_onSaveCallback) _onSaveCallback(_currentPresetKey);
    } catch (e) {
        showToast(`保存失败: ${e.message}`, 'error');
    }
}

function close() {
    if (_dirty) {
        if (!confirm('有未保存的修改，确定关闭？')) return;
    }
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
}

// ============ Public API ============

/**
 * Open the prompts editor modal.
 * @param {string} [initialPresetKey='zh'] - preset key to show initially
 * @param {Function} [onSave] - callback(newKey) after save/delete
 */
export async function openPromptsEditor(initialPresetKey = 'zh', onSave) {
    _onSaveCallback = onSave || null;
    const modal = ensureModal();
    ensureStyles();

    // Load user presets first
    await loadUserPresets(true);
    await refreshPresetSelect(initialPresetKey);
    await loadPreset(initialPresetKey);

    modal.style.display = 'block';
}

// ============ Styles ============

let _stylesInjected = false;
function ensureStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        .pe-task-item {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 14px; cursor: pointer; font-size: 12px;
            color: var(--text-secondary); transition: background 0.12s;
            user-select: none;
        }
        .pe-task-item:hover { background: var(--bg-pill); }
        .pe-task-selected { background: var(--bg-pill); color: var(--accent-light); font-weight: 600; }
        .pe-task-empty { opacity: 0.5; }
        .pe-task-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--text-faint); flex-shrink: 0;
        }
        .pe-task-dot-on { background: var(--accent); }
        .pe-task-name {
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            flex: 1; min-width: 0;
        }
    `;
    document.head.appendChild(style);
}
