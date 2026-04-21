// ============ Import Project Dialog ============

import { state, resetTreeExpanded, normalizeProject } from './state.js';
import { saveProject, clearUndoRedo, pickProjectFromLocal, cloneImportedProject } from './storage.js';
import { navigateTo } from './views.js';
import { showToast } from './utils.js';

let modalEl = null;
let selectedImportProject = null;
let selectedImportFileName = '';

function cloneItemForMerge(item) {
    const cloned = JSON.parse(JSON.stringify(item || {}));
    cloned.id = crypto.randomUUID();
    if ('folderId' in cloned) cloned.folderId = null;
    return cloned;
}

function summarizeProject(project) {
    return {
        title: project?.title || '未命名项目',
        characters: project?.characters?.length || 0,
        scenes: project?.scenes?.length || 0,
        props: project?.props?.length || 0,
        shorts: project?.shorts?.length || 0,
    };
}

function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.id = 'importProjectModal';
    modalEl.className = 'hidden';
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
    modalEl.innerHTML = `
        <div class="card-flat fade-in" style="width:560px;max-width:92vw;max-height:85vh;overflow-y:auto;padding:24px" onclick="event.stopPropagation()">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="font-size:16px;font-weight:700;color:var(--text-primary)">从本地导入</h3>
                <button id="importProjClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1">&times;</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
                <div class="card-flat" style="padding:14px;border-style:dashed">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                        <div>
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">选择本地项目文件</div>
                            <div id="importProjFileHint" style="font-size:12px;color:var(--text-muted);margin-top:4px">支持 .json / .md / .aimovie</div>
                        </div>
                        <button id="importProjChooseFile" class="btn-secondary" style="padding:8px 14px;font-size:12px">选择文件…</button>
                    </div>
                    <div id="importProjSummary" class="hidden" style="margin-top:12px;padding:12px;border-radius:10px;background:var(--bg-pill);border:1px solid var(--border-card)"></div>
                </div>

                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:8px">导入方式</label>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        <label class="card-flat" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer">
                            <input type="radio" name="importMode" value="replace" checked style="margin-top:2px">
                            <div>
                                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">完全加载</div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">把选中的本地项目作为新项目加载到编辑器中。</div>
                            </div>
                        </label>
                        <label id="importMergeCard" class="card-flat" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer">
                            <input id="importModeMerge" type="radio" name="importMode" value="merge" style="margin-top:2px">
                            <div style="flex:1;min-width:0">
                                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">合并到当前项目</div>
                                <div id="importMergeHint" style="font-size:12px;color:var(--text-muted);margin-top:4px">只导入角色、场景、道具，并追加到当前项目。</div>
                                <div id="importMergeOptions" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-card)">
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="importCharsChk" type="checkbox" checked>角色</label>
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="importScenesChk" type="checkbox" checked>场景</label>
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="importPropsChk" type="checkbox" checked>道具</label>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px">
                <button id="importProjCancel" class="btn-secondary" style="padding:8px 18px;font-size:13px">取消</button>
                <button id="importProjApply" class="btn-primary" style="padding:8px 22px;font-size:13px">导入</button>
            </div>
        </div>
    `;

    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) hideImportProjectModal();
    });

    document.body.appendChild(modalEl);

    modalEl.querySelector('#importProjClose').onclick = hideImportProjectModal;
    modalEl.querySelector('#importProjCancel').onclick = hideImportProjectModal;
    modalEl.querySelector('#importProjChooseFile').onclick = handleChooseFile;
    modalEl.querySelector('#importProjApply').onclick = handleApplyImport;
    modalEl.querySelectorAll('input[name="importMode"]').forEach(input => {
        input.addEventListener('change', syncModeState);
    });

    return modalEl;
}

function syncModeState() {
    if (!modalEl) return;
    const canMerge = !!state.currentProject;
    const mergeRadio = modalEl.querySelector('#importModeMerge');
    const mergeCard = modalEl.querySelector('#importMergeCard');
    const mergeHint = modalEl.querySelector('#importMergeHint');
    const mergeOptions = modalEl.querySelector('#importMergeOptions');
    const isMerge = modalEl.querySelector('input[name="importMode"]:checked')?.value === 'merge';

    mergeRadio.disabled = !canMerge;
    mergeCard.style.opacity = canMerge ? '1' : '0.55';
    mergeCard.style.cursor = canMerge ? 'pointer' : 'not-allowed';
    mergeHint.textContent = canMerge
        ? '只导入角色、场景、道具，并追加到当前项目。'
        : '当前没有打开的项目，无法执行合并导入。';
    mergeOptions.style.display = isMerge && canMerge ? 'flex' : 'none';

    if (!canMerge && isMerge) {
        modalEl.querySelector('input[name="importMode"][value="replace"]').checked = true;
    }
}

function renderSelectedProjectSummary() {
    if (!modalEl) return;
    const summaryEl = modalEl.querySelector('#importProjSummary');
    const hintEl = modalEl.querySelector('#importProjFileHint');
    if (!selectedImportProject) {
        summaryEl.classList.add('hidden');
        summaryEl.innerHTML = '';
        hintEl.textContent = '支持 .json / .md / .aimovie';
        return;
    }

    const summary = summarizeProject(selectedImportProject);
    hintEl.textContent = selectedImportFileName || '已选择项目文件';
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${summary.title}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${selectedImportFileName || '本地项目文件'}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                <span class="status-badge status-idle">角色 ${summary.characters}</span>
                <span class="status-badge status-idle">场景 ${summary.scenes}</span>
                <span class="status-badge status-idle">道具 ${summary.props}</span>
                <span class="status-badge status-idle">分镜 ${summary.shorts}</span>
            </div>
        </div>
    `;
}

async function handleChooseFile() {
    try {
        const { file, project } = await pickProjectFromLocal();
        selectedImportProject = project;
        selectedImportFileName = file?.name || '';
        renderSelectedProjectSummary();
    } catch (e) {
        if (e.message !== '未选择文件') {
            showToast(`读取失败: ${e.message}`, 'error');
        }
    }
}

function mergeSelectedParts(targetProject, sourceProject, options) {
    let importedCharacters = 0;
    let importedScenes = 0;
    let importedProps = 0;

    if (options.characters) {
        const incoming = (sourceProject.characters || []).map(item => cloneItemForMerge(item));
        targetProject.characters.push(...incoming);
        importedCharacters = incoming.length;
    }

    if (options.scenes) {
        const incoming = (sourceProject.scenes || []).map(item => cloneItemForMerge(item));
        targetProject.scenes.push(...incoming);
        importedScenes = incoming.length;
    }

    if (options.props) {
        const incoming = (sourceProject.props || []).map(item => cloneItemForMerge(item));
        targetProject.props.push(...incoming);
        importedProps = incoming.length;
    }

    targetProject.updatedAt = Date.now();
    normalizeProject(targetProject);

    return {
        characters: importedCharacters,
        scenes: importedScenes,
        props: importedProps,
    };
}

function buildMergeToast(result) {
    const parts = [];
    if (result.characters > 0) parts.push(`角色 ${result.characters}`);
    if (result.scenes > 0) parts.push(`场景 ${result.scenes}`);
    if (result.props > 0) parts.push(`道具 ${result.props}`);
    return parts.length > 0 ? `已导入 ${parts.join('，')}` : '没有可导入的内容';
}

async function handleApplyImport() {
    if (!selectedImportProject) {
        showToast('请先选择本地项目文件', 'info');
        return;
    }

    const mode = modalEl.querySelector('input[name="importMode"]:checked')?.value || 'replace';

    if (mode === 'replace') {
        const importedProject = cloneImportedProject(selectedImportProject);
        state.currentProject = importedProject;
        clearUndoRedo();
        resetTreeExpanded();
        if (state.token) {
            await saveProject(importedProject);
        }
        hideImportProjectModal();
        showToast(`已导入项目: ${importedProject.title}`, 'success');
        navigateTo('breakdown');
        return;
    }

    if (!state.currentProject) {
        showToast('请先打开一个项目，再执行合并导入', 'error');
        return;
    }

    const options = {
        characters: modalEl.querySelector('#importCharsChk').checked,
        scenes: modalEl.querySelector('#importScenesChk').checked,
        props: modalEl.querySelector('#importPropsChk').checked,
    };

    if (!options.characters && !options.scenes && !options.props) {
        showToast('请至少选择一种导入内容', 'info');
        return;
    }

    const result = mergeSelectedParts(state.currentProject, selectedImportProject, options);
    if (state.token) {
        await saveProject(state.currentProject);
    }
    hideImportProjectModal();
    showToast(buildMergeToast(result), result.characters || result.scenes || result.props ? 'success' : 'info');
    navigateTo(state.currentView === 'projectList' ? 'breakdown' : state.currentView);
}

export function showImportProjectModal() {
    const modal = ensureModal();
    selectedImportProject = null;
    selectedImportFileName = '';
    modal.querySelector('input[name="importMode"][value="replace"]').checked = true;
    modal.querySelector('#importCharsChk').checked = true;
    modal.querySelector('#importScenesChk').checked = true;
    modal.querySelector('#importPropsChk').checked = true;
    renderSelectedProjectSummary();
    syncModeState();
    modal.style.display = 'flex';
}

export function hideImportProjectModal() {
    if (!modalEl) return;
    modalEl.style.display = 'none';
}