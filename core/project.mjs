import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

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
  return {
    title: project.title || document.summary?.title || '未命名项目',
    shorts: Array.isArray(project.shorts) ? project.shorts.length : 0,
    characters: Array.isArray(project.characters) ? project.characters.length : 0,
    scenes: Array.isArray(project.scenes) ? project.scenes.length : 0,
    ratio: project.settings?.ratio || '16:9',
    imageModel: project.settings?.imageModel || null,
    videoModel: project.settings?.model || null,
    status: project.status || 'unknown',
    pipelineStage: project.pipelineStage || 'unknown',
  };
}
