// ============ Export Project Dialog ============

import { state } from './state.js';
import { exportProjectToLocal, summarizeLocalExport } from './storage.js';
import { showToast } from './utils.js';

let modalEl = null;

function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.id = 'exportProjectModal';
    modalEl.className = 'hidden';
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
    modalEl.innerHTML = `
        <div class="card-flat fade-in" style="width:600px;max-width:92vw;max-height:85vh;overflow-y:auto;padding:24px" onclick="event.stopPropagation()">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="font-size:16px;font-weight:700;color:var(--text-primary)">导出到本地</h3>
                <button id="exportProjClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1">&times;</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
                <div class="card-flat" style="padding:14px;border-style:dashed">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary)">当前项目</div>
                    <div id="exportProjTitle" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
                    <div id="exportProjSummary" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"></div>
                </div>

                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:8px">导出方式</label>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        <label class="card-flat" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer">
                            <input type="radio" name="exportMode" value="all" checked style="margin-top:2px">
                            <div>
                                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">导出全部</div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">导出完整项目 JSON，以及所选资源文件。</div>
                            </div>
                        </label>
                        <label class="card-flat" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer">
                            <input id="exportModeCustom" type="radio" name="exportMode" value="custom" style="margin-top:2px">
                            <div style="flex:1;min-width:0">
                                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">按内容导出</div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">只导出选中的角色、场景、道具、分镜数据。</div>
                                <div id="exportCustomOptions" style="display:none;gap:16px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-card)">
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="exportCharsChk" type="checkbox" checked>角色</label>
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="exportScenesChk" type="checkbox" checked>场景</label>
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="exportPropsChk" type="checkbox" checked>道具</label>
                                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer"><input id="exportShortsChk" type="checkbox" checked>分镜</label>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <div class="card-flat" style="padding:14px">
                    <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
                        <input id="exportDownloadAssetsChk" type="checkbox" checked style="margin-top:2px">
                        <div>
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">下载资源到本地文件夹</div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">关闭后只导出项目 JSON，保留原始资源 URL，不下载图片、音频和视频。</div>
                        </div>
                    </label>
                </div>

                <div class="card-flat" style="padding:14px;background:var(--bg-pill)">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                        <div>
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">本次导出预览</div>
                            <div id="exportPreviewText" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
                        </div>
                        <div id="exportPreviewBadges" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"></div>
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px">
                <button id="exportProjCancel" class="btn-secondary" style="padding:8px 18px;font-size:13px">取消</button>
                <button id="exportProjApply" class="btn-primary" style="padding:8px 22px;font-size:13px">导出</button>
            </div>
        </div>
    `;

    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) hideExportProjectModal();
    });

    document.body.appendChild(modalEl);

    modalEl.querySelector('#exportProjClose').onclick = hideExportProjectModal;
    modalEl.querySelector('#exportProjCancel').onclick = hideExportProjectModal;
    modalEl.querySelector('#exportProjApply').onclick = handleApplyExport;
    modalEl.querySelectorAll('input[name="exportMode"]').forEach(input => {
        input.addEventListener('change', syncModeState);
        input.addEventListener('change', refreshPreview);
    });
    ['#exportCharsChk', '#exportScenesChk', '#exportPropsChk', '#exportShortsChk', '#exportDownloadAssetsChk'].forEach(selector => {
        modalEl.querySelector(selector).addEventListener('change', refreshPreview);
    });

    return modalEl;
}

function getExportOptions() {
    const mode = modalEl?.querySelector('input[name="exportMode"]:checked')?.value || 'all';
    return {
        mode,
        includeCharacters: mode === 'all' ? true : modalEl.querySelector('#exportCharsChk').checked,
        includeScenes: mode === 'all' ? true : modalEl.querySelector('#exportScenesChk').checked,
        includeProps: mode === 'all' ? true : modalEl.querySelector('#exportPropsChk').checked,
        includeShorts: mode === 'all' ? true : modalEl.querySelector('#exportShortsChk').checked,
        downloadAssets: modalEl.querySelector('#exportDownloadAssetsChk').checked,
    };
}

function syncModeState() {
    if (!modalEl) return;
    const isCustom = modalEl.querySelector('input[name="exportMode"]:checked')?.value === 'custom';
    modalEl.querySelector('#exportCustomOptions').style.display = isCustom ? 'flex' : 'none';
}

function renderProjectSummary(project) {
    const titleEl = modalEl.querySelector('#exportProjTitle');
    const summaryEl = modalEl.querySelector('#exportProjSummary');
    titleEl.textContent = project?.title || '未命名项目';
    const summary = summarizeLocalExport(project, { mode: 'all' });
    summaryEl.innerHTML = `
        <span class="status-badge status-idle">角色 ${summary.counts.characters}</span>
        <span class="status-badge status-idle">场景 ${summary.counts.scenes}</span>
        <span class="status-badge status-idle">道具 ${summary.counts.props}</span>
        <span class="status-badge status-idle">分镜 ${summary.counts.shorts}</span>
        <span class="status-badge status-idle">资源 ${summary.assets.length}</span>
    `;
}

function refreshPreview() {
    if (!modalEl || !state.currentProject) return;
    const options = getExportOptions();
    const previewEl = modalEl.querySelector('#exportPreviewText');
    const badgesEl = modalEl.querySelector('#exportPreviewBadges');
    const summary = summarizeLocalExport(state.currentProject, options);

    previewEl.textContent = options.downloadAssets
        ? `会导出项目 JSON，并下载 ${summary.assets.length} 个资源文件。`
        : '会导出项目 JSON，不下载资源文件。';

    badgesEl.innerHTML = `
        <span class="status-badge status-idle">角色 ${summary.counts.characters}</span>
        <span class="status-badge status-idle">场景 ${summary.counts.scenes}</span>
        <span class="status-badge status-idle">道具 ${summary.counts.props}</span>
        <span class="status-badge status-idle">分镜 ${summary.counts.shorts}</span>
        <span class="status-badge status-idle">资源 ${summary.assets.length}</span>
    `;
}

async function handleApplyExport() {
    const project = state.currentProject;
    if (!project) {
        showToast('请先打开一个项目', 'info');
        return;
    }

    const options = getExportOptions();
    if (options.mode === 'custom' && !options.includeCharacters && !options.includeScenes && !options.includeProps && !options.includeShorts) {
        showToast('请至少选择一种导出内容', 'info');
        return;
    }

    try {
        showToast(options.downloadAssets ? '正在导出，请选择保存目录…' : '正在导出项目文件，请选择保存目录…', 'info');
        const result = await exportProjectToLocal(project, (done, total, msg) => {
            if (options.downloadAssets && total > 0) showToast(`导出进度: ${done}/${total} — ${msg}`, 'info');
        }, options);
        hideExportProjectModal();
        if (!result.downloadAssets) {
            showToast(`导出完成: 已生成项目文件，跳过 ${result.skippedAssets} 个资源下载`, 'success');
            return;
        }
        if (result.failed > 0) showToast(`导出完成: ${result.done}/${result.total} 个文件, ${result.failed} 个失败`, 'info');
        else showToast(`导出完成: ${result.total} 个资源已保存`, 'success');
    } catch (e) {
        if (e.name !== 'AbortError') showToast(`导出失败: ${e.message}`, 'error');
    }
}

export function showExportProjectModal() {
    const project = state.currentProject;
    if (!project) {
        showToast('请先打开一个项目', 'info');
        return;
    }

    const modal = ensureModal();
    modal.querySelector('input[name="exportMode"][value="all"]').checked = true;
    modal.querySelector('#exportCharsChk').checked = true;
    modal.querySelector('#exportScenesChk').checked = true;
    modal.querySelector('#exportPropsChk').checked = true;
    modal.querySelector('#exportShortsChk').checked = true;
    modal.querySelector('#exportDownloadAssetsChk').checked = true;
    syncModeState();
    renderProjectSummary(project);
    refreshPreview();
    modal.style.display = 'flex';
}

export function hideExportProjectModal() {
    if (!modalEl) return;
    modalEl.style.display = 'none';
}