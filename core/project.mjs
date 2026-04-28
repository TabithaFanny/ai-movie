import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import xlsx from 'xlsx';

function nowMs() {
  return Date.now();
}

function ensureAimovieExtension(filePath) {
  return filePath.endsWith('.aimovie.md') ? filePath : `${filePath}.aimovie.md`;
}

function buildSummary(project) {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    workspace: 'AIMovieMaker',
    projectFileName: `${project.title}.aimovie.md`,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    shortCount: Array.isArray(project.shorts) ? project.shorts.length : 0,
    totalDuration: project.totalDuration || 0,
    episodeCount: project.episodeCount || 1,
    localMode: !!project.localMode,
  };
}

export function createProject(title, options = {}) {
  const createdAt = nowMs();
  const project = {
    id: crypto.randomUUID(),
    title: title || '未命名项目',
    workspace: null,
    projectFileName: null,
    script: options.script || '',
    synopsis: options.synopsis || '',
    totalDuration: Number(options.totalDuration || 3),
    episodeCount: Math.max(1, Number(options.episodeCount || 1)),
    status: 'idle',
    pipelineStage: 'draft',
    settings: {
      resolution: '720p',
      ratio: options.ratio || '16:9',
      model: 'seedance-2.0-fast',
      generateAudio: true,
      defaultDuration: 5,
      narrationVoice: '',
      narrationVoiceName: '',
      narrationSpeed: 0,
      narrationLanguage: 'zh',
      stylePreset: options.stylePreset || '3d-semirealistic',
      customStyleSuffix: '',
      envPreset: '',
      customEnvSuffix: '',
      racePreset: '',
      customRaceSuffix: '',
      promptPreset: 'zh',
    },
    characters: [],
    props: [],
    scenes: [],
    shorts: [],
    folders: [],
    localMode: false,
    createdAt,
    updatedAt: createdAt,
  };

  return {
    format: 'aimovie',
    version: 1,
    summary: buildSummary(project),
    project,
  };
}

export async function loadAimovieFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed?.format !== 'aimovie' || !parsed?.project) {
    throw new Error(`Unsupported project file: ${filePath}`);
  }
  return parsed;
}

export async function saveAimovieFile(filePath, document) {
  const targetPath = ensureAimovieExtension(filePath);
  const project = document.project || {};
  project.updatedAt = nowMs();
  if (!project.createdAt) project.createdAt = project.updatedAt;
  project.status = project.status || 'idle';
  document.summary = buildSummary(project);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(document, null, 2), 'utf8');
  return targetPath;
}

export function describeProject(document) {
  const project = document.project || {};
  const shorts = Array.isArray(project.shorts) ? project.shorts : [];
  const byStatus = shorts.reduce((acc, short) => {
    const key = short.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    title: project.title || document.summary?.title || '未命名项目',
    shorts: shorts.length,
    characters: Array.isArray(project.characters) ? project.characters.length : 0,
    scenes: Array.isArray(project.scenes) ? project.scenes.length : 0,
    ratio: project.settings?.ratio || '16:9',
    imageModel: project.settings?.imageModel || null,
    videoModel: project.settings?.model || null,
    status: project.status || 'unknown',
    pipelineStage: project.pipelineStage || 'unknown',
    shortStatusCounts: byStatus,
  };
}

export function setProjectStage(document, pipelineStage, status) {
  if (!document?.project) throw new Error('Project document missing');
  if (pipelineStage) document.project.pipelineStage = pipelineStage;
  if (status) document.project.status = status;
  return document;
}

export function updateShotStatus(document, shotOrder, updates = {}) {
  if (!document?.project?.shorts) throw new Error('Project document has no shorts');
  const targetOrder = Number(shotOrder);
  if (!Number.isFinite(targetOrder)) throw new Error(`Invalid shot order: ${shotOrder}`);
  const shot = document.project.shorts.find(item => Number(item.order) === targetOrder);
  if (!shot) throw new Error(`Shot not found: ${shotOrder}`);

  const allowedKeys = ['status', 'taskId', 'videoUrl', 'videoPath', 'sourceVideoUrl', 'referenceVideoUrl', 'error', 'picturebookStatus', 'picturebookUrl', 'picturebookError'];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === '') continue;
    if (!allowedKeys.includes(key)) continue;
    shot[key] = value;
  }

  if (updates.clearError) shot.error = null;
  if (updates.clearTaskId) shot.taskId = null;

  if (shot.status === 'succeeded' && shot.videoUrl) {
    document.project.status = document.project.shorts.every(item => item.status === 'succeeded' || item.status === 'failed')
      ? 'completed'
      : (document.project.status || 'editing');
  } else if (shot.status === 'running') {
    document.project.status = 'generating';
    document.project.pipelineStage = 'generating';
  } else if (shot.status === 'failed' && document.project.status === 'idle') {
    document.project.status = 'editing';
  }

  return shot;
}

function normalizeCell(value) {
  return value == null ? '' : String(value).trim();
}

function sectionId(name) {
  return `folder-${name.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').toLowerCase() || crypto.randomUUID()}`;
}

function simpleId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function inferSceneId(scenes, name, description) {
  const existing = scenes.find(scene => scene.name === name);
  if (existing) return existing.id;
  const id = simpleId('scene');
  scenes.push({ id, name, description });
  return id;
}

function inferCharacterIds(characters, visualText) {
  const ids = [];
  const ensureCharacter = (name, description) => {
    let character = characters.find(item => item.name === name);
    if (!character) {
      character = { id: simpleId('char'), name, description };
      characters.push(character);
    }
    ids.push(character.id);
  };

  if (visualText.includes('土耳其男生') || visualText.includes('男生')) {
    ensureCharacter('土耳其男生', '刚毕业准备进入外企面试的土耳其男生，前期紧张焦虑，后期逐渐建立自信。');
  }
  if (visualText.includes('日本女生')) {
    ensureCharacter('日本女生', '住在东京公寓、渴望与世界连接的女生。');
  }
  if (visualText.includes('女生') && !visualText.includes('日本女生')) {
    ensureCharacter('旅行女生', '独自出国旅行的年轻女生，前期迷茫，后期逐渐放松自信。');
  }
  if (visualText.includes('外国') || visualText.includes('语伴') || visualText.includes('主播') || visualText.includes('朋友')) {
    ensureCharacter('外国语伴/朋友', '通过 HelloTalk 出现的国际语伴、主播和朋友们，代表跨语言连接与真实互动。');
  }
  return [...new Set(ids)];
}

function inferSceneForVisual(scenes, visualText) {
  if (visualText.includes('机场')) {
    return inferSceneId(scenes, '国际机场', '繁忙国际机场，人流穿梭，体现初到异国的陌生感。');
  }
  if (visualText.includes('迪拜') || visualText.includes('公司大楼') || visualText.includes('面试')) {
    return inferSceneId(scenes, '写字楼与面试空间', '现代商务大楼与面试环境，体现进入外企的职场压力。');
  }
  if (visualText.includes('东京') || visualText.includes('公寓') || visualText.includes('客厅')) {
    return inferSceneId(scenes, '东京夜景公寓', '东京塔可见的深夜城市与公寓客厅，体现孤独与社交渴望。');
  }
  if (visualText.includes('手机') || visualText.includes('屏幕') || visualText.includes('HelloTalk') || visualText.includes('数据动效') || visualText.includes('Logo')) {
    return inferSceneId(scenes, 'HelloTalk 手机界面', 'HelloTalk 的找语伴、动态、直播、数据动效与品牌界面特写。');
  }
  return inferSceneId(scenes, '街头与社交空间', '街头打卡、直播互动、跨国社交等人与人真实连接的空间。');
}

export function createProjectFromStoryboardRows(title, rows) {
  const document = createProject(title, {
    ratio: '16:9',
    stylePreset: 'photorealistic',
  });
  const project = document.project;

  const concepts = [];
  const scenes = [];
  const characters = [];
  const folders = [];
  const folderByName = new Map();
  const shorts = [];

  let currentSection = '';
  let currentTime = '';

  for (const row of rows) {
    const timeSeg = normalizeCell(row.timeSeg);
    const section = normalizeCell(row.section);
    const shotNo = row.shotNo;
    const visual = normalizeCell(row.visual);
    const subtitle = normalizeCell(row.subtitle);
    const narration = normalizeCell(row.narration);
    const bgm = normalizeCell(row.bgm);

    if (section) currentSection = section;
    if (timeSeg) currentTime = timeSeg;

    if (!shotNo && visual) {
      concepts.push(visual);
      continue;
    }

    if (!shotNo || !visual) continue;

    if (!folderByName.has(currentSection)) {
      const folder = {
        id: sectionId(currentSection || `section-${folderByName.size + 1}`),
        name: currentSection || `章节 ${folderByName.size + 1}`,
        order: folderByName.size + 1,
        category: 'shorts',
      };
      folderByName.set(folder.name, folder);
      folders.push(folder);
    }

    const sceneId = inferSceneForVisual(scenes, visual);
    const characterIds = inferCharacterIds(characters, visual);
    let prompt = `品牌宣传片镜头，章节：${currentSection || '未分组'}，时间段：${currentTime || '未标注'}。画面：${visual}。整体调性：真实国际化、电影感、情绪递进、广告片质感。`;
    if (subtitle) prompt += ` 画面字幕信息：${subtitle}。`;
    if (bgm) prompt += ` 背景音效/音乐：${bgm}。`;
    if (concepts.length > 0) prompt += ` 创意概念：${concepts.join('；')}。`;

    shorts.push({
      id: simpleId('shot'),
      order: Number(shotNo),
      folderId: folderByName.get(currentSection || folders[folders.length - 1].name).id,
      sceneId,
      characterIds,
      propIds: [],
      prompt,
      duration: currentSection.includes('结尾') ? 4 : 5,
      ratio: '16:9',
      imageUrls: [],
      imagePaths: [],
      taskId: null,
      status: 'pending',
      videoUrl: null,
      videoPath: null,
      sourceVideoUrl: null,
      referenceVideoUrl: null,
      referenceVideoSourceShortId: null,
      firstFrameUrl: null,
      lastFrameUrl: null,
      audioUrls: [],
      modelOverride: null,
      generateAudioOverride: null,
      watermark: false,
      error: null,
      shotType: '广告分镜',
      cameraMovement: null,
      cameraAngle: null,
      lighting: null,
      emotion: null,
      stableVariables: null,
      enhanced: false,
      dialogue: subtitle,
      narration,
    });
  }

  project.title = title || project.title;
  project.script = concepts.join('\n');
  project.synopsis = concepts.length > 0 ? concepts.join('；') : '';
  project.characters = characters;
  project.scenes = scenes;
  project.folders = folders;
  project.shorts = shorts.sort((a, b) => a.order - b.order);
  project.status = 'editing';
  project.pipelineStage = 'parsed';
  project.settings.stylePreset = 'photorealistic';
  project.settings.envPreset = 'modern';
  project.settings.racePreset = 'mixed';

  document.summary = buildSummary(project);
  return document;
}

export function readStoryboardWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`Workbook has no sheets: ${filePath}`);
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (rows.length < 2) {
    throw new Error(`Workbook does not look like a storyboard sheet: ${filePath}`);
  }

  return rows.slice(2).map(row => ({
    timeSeg: row[0],
    section: row[1],
    shotNo: row[2],
    visual: row[3],
    reference: row[4],
    subtitle: row[5],
    narration: row[6],
    bgm: row[7],
  }));
}
