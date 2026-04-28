#!/usr/bin/env node

import path from 'path';
import {
  createProject,
  createProjectFromStoryboardRows,
  describeProject,
  getShotByOrder,
  loadAimovieFile,
  readStoryboardWorkbook,
  saveAimovieFile,
  setProjectStage,
  updateShotStatus,
} from '../core/project.mjs';
import { analyzeProjectDocument, buildAnalyzePrompt, getAnalysisRuntimeConfig } from '../core/analyze.mjs';
import { generateImagesForScope, getImageRuntimeConfig } from '../core/image.mjs';
import { fetchVideoTaskStatus, getVideoRuntimeConfig, submitVideoGeneration } from '../core/video.mjs';

function usage() {
  console.log(`AIMM CLI

Usage:
  aimm create <title> [output]
  aimm inspect <project.aimovie.md>
  aimm agent-status <project.aimovie.md>
  aimm agent-cycle <project.aimovie.md>
  aimm import-aimovie <input.aimovie.md> [output]
  aimm import-xlsx <storyboard.xlsx> [output]
  aimm analyze <project.aimovie.md>
  aimm prompt-analyze <project.aimovie.md>
  aimm gen-video <project.aimovie.md> <shotOrder>
  aimm poll-video <project.aimovie.md> <shotOrder>
  aimm set-stage <project.aimovie.md> <pipelineStage> [status]
  aimm set-shot-status <project.aimovie.md> <shotOrder> <status> [videoUrl]
  aimm gen-image <project.aimovie.md> [scope]
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function summarizeAssetCoverage(project) {
  const characters = project.characters || [];
  const scenes = project.scenes || [];
  const props = project.props || [];
  const shorts = project.shorts || [];

  return {
    characters: {
      total: characters.length,
      ready: characters.filter(item => item.imageUrl || item.anchorImageUrl).length,
      missing: characters.filter(item => item.description && !item.imageUrl && !item.anchorImageUrl).length,
    },
    scenes: {
      total: scenes.length,
      ready: scenes.filter(item => item.imageUrl).length,
      missing: scenes.filter(item => item.description && !item.imageUrl).length,
    },
    props: {
      total: props.length,
      ready: props.filter(item => item.imageUrl || item.anchorImageUrl).length,
      missing: props.filter(item => item.description && !item.imageUrl && !item.anchorImageUrl).length,
    },
    shorts: {
      total: shorts.length,
      pending: shorts.filter(item => item.status === 'pending').length,
      running: shorts.filter(item => item.status === 'running').length,
      succeeded: shorts.filter(item => item.status === 'succeeded').length,
      failed: shorts.filter(item => item.status === 'failed').length,
      withTaskId: shorts.filter(item => item.taskId).length,
      readyForFrontendVideo: shorts.filter(item => item.prompt && item.status === 'pending').length,
    },
  };
}

function computeNextActions(project) {
  const coverage = summarizeAssetCoverage(project);
  const actions = [];
  const hasScript = !!project.script?.trim();

  if ((!project.shorts || project.shorts.length === 0) && hasScript) {
    actions.push({
      kind: 'analyze',
      reason: 'project has script but no generated breakdown yet',
      command: 'aimm analyze <project.aimovie.md>',
      requires: ['AIMM_LLM_API_KEY'],
    });
  }

  if (coverage.characters.missing > 0) {
    actions.push({
      kind: 'gen-image:characters',
      reason: `${coverage.characters.missing} characters still need images`,
      command: 'aimm gen-image <project.aimovie.md> characters',
      requires: ['AIMM_IMAGE_API_KEY'],
    });
  }

  if (coverage.scenes.missing > 0) {
    actions.push({
      kind: 'gen-image:scenes',
      reason: `${coverage.scenes.missing} scenes still need images`,
      command: 'aimm gen-image <project.aimovie.md> scenes',
      requires: ['AIMM_IMAGE_API_KEY'],
    });
  }

  if (coverage.props.missing > 0) {
    actions.push({
      kind: 'gen-image:props',
      reason: `${coverage.props.missing} props still need images`,
      command: 'aimm gen-image <project.aimovie.md> props',
      requires: ['AIMM_IMAGE_API_KEY'],
    });
  }

  if (coverage.shorts.running > 0) {
    actions.push({
      kind: 'monitor-video',
      reason: `${coverage.shorts.running} shots are marked running`,
      command: 'aimm poll-video <project.aimovie.md> <shotOrder>',
      requires: ['AIMM_VIDEO_API_KEY'],
    });
  }

  if (coverage.shorts.readyForFrontendVideo > 0) {
    actions.push({
      kind: 'frontend-keepwork-video',
      reason: `${coverage.shorts.readyForFrontendVideo} shots are ready for Keepwork video generation`,
      command: 'Open the project in AIMovieMaker frontend and use Keepwork video generation',
      requires: ['keepwork login'],
    });
  }

  if (actions.length === 0) {
    actions.push({
      kind: 'idle',
      reason: 'no obvious next action',
      command: null,
      requires: [],
    });
  }

  return actions;
}

async function cmdAgentStatus(args) {
  const [input] = args;
  if (!input) fail('agent-status requires a project file');
  const doc = await loadAimovieFile(input);
  const summary = describeProject(doc);
  const coverage = summarizeAssetCoverage(doc.project);
  const nextActions = computeNextActions(doc.project);
  console.log(JSON.stringify({
    project: input,
    summary,
    coverage,
    nextActions,
  }, null, 2));
}

async function cmdAgentCycle(args) {
  const [input] = args;
  if (!input) fail('agent-cycle requires a project file');
  const doc = await loadAimovieFile(input);
  const project = doc.project;
  const steps = [];

  if ((!project.shorts || project.shorts.length === 0) && project.script?.trim()) {
    const runtime = getAnalysisRuntimeConfig();
    if (runtime.apiKey) {
      const result = await analyzeProjectDocument(doc);
      steps.push({
        kind: 'analyze',
        status: 'completed',
        model: result.runtime.model,
        counts: {
          characters: doc.project.characters.length,
          props: doc.project.props.length,
          scenes: doc.project.scenes.length,
          shorts: doc.project.shorts.length,
        },
      });
    } else {
      steps.push({
        kind: 'analyze',
        status: 'blocked',
        reason: 'Missing AIMM_LLM_API_KEY or OPENAI_API_KEY',
      });
    }
  }

  const imageRuntime = getImageRuntimeConfig();
  const coverageBeforeImages = summarizeAssetCoverage(project);
  if (imageRuntime.apiKey) {
    if (coverageBeforeImages.characters.missing > 0) {
      const results = await generateImagesForScope(project, 'characters');
      steps.push({
        kind: 'gen-image:characters',
        status: 'completed',
        succeeded: results.filter(item => item.status === 'succeeded').length,
        failed: results.filter(item => item.status === 'failed').length,
      });
    }
    if (coverageBeforeImages.scenes.missing > 0) {
      const results = await generateImagesForScope(project, 'scenes');
      steps.push({
        kind: 'gen-image:scenes',
        status: 'completed',
        succeeded: results.filter(item => item.status === 'succeeded').length,
        failed: results.filter(item => item.status === 'failed').length,
      });
    }
    if (coverageBeforeImages.props.missing > 0) {
      const results = await generateImagesForScope(project, 'props');
      steps.push({
        kind: 'gen-image:props',
        status: 'completed',
        succeeded: results.filter(item => item.status === 'succeeded').length,
        failed: results.filter(item => item.status === 'failed').length,
      });
    }
  } else if (coverageBeforeImages.characters.missing > 0 || coverageBeforeImages.scenes.missing > 0 || coverageBeforeImages.props.missing > 0) {
    steps.push({
      kind: 'gen-image',
      status: 'blocked',
      reason: 'Missing AIMM_IMAGE_API_KEY or OPENAI_API_KEY',
    });
  }

  const coverageAfter = summarizeAssetCoverage(project);
  const nextActions = computeNextActions(project);
  if (coverageAfter.shorts.readyForFrontendVideo > 0) {
    steps.push({
      kind: 'frontend-keepwork-video',
      status: 'handoff',
      reason: `${coverageAfter.shorts.readyForFrontendVideo} shots are ready for Keepwork video generation in the frontend`,
    });
  }

  const written = await saveAimovieFile(input, doc);
  console.log(JSON.stringify({
    project: written,
    summary: describeProject(doc),
    coverage: coverageAfter,
    steps,
    nextActions,
  }, null, 2));
}

async function cmdCreate(args) {
  const [title, output] = args;
  if (!title) fail('create requires a project title');
  const doc = createProject(title);
  const target = output || path.resolve(process.cwd(), `${title}.aimovie.md`);
  const written = await saveAimovieFile(target, doc);
  console.log(`Created project: ${written}`);
}

async function cmdInspect(args) {
  const [input] = args;
  if (!input) fail('inspect requires a project file');
  const doc = await loadAimovieFile(input);
  const summary = describeProject(doc);
  console.log(JSON.stringify(summary, null, 2));
}

async function cmdImportAimovie(args) {
  const [input, output] = args;
  if (!input) fail('import-aimovie requires an input project file');
  const doc = await loadAimovieFile(input);
  const target = output || path.resolve(process.cwd(), path.basename(input));
  const written = await saveAimovieFile(target, doc);
  console.log(`Imported project: ${written}`);
}

async function cmdImportXlsx(args) {
  const [input, output] = args;
  if (!input) fail('import-xlsx requires an xlsx file');
  const rows = readStoryboardWorkbook(input);
  const title = path.basename(input, path.extname(input));
  const doc = createProjectFromStoryboardRows(title, rows);
  const target = output || path.resolve(process.cwd(), `${title}.aimovie.md`);
  const written = await saveAimovieFile(target, doc);
  console.log(`Imported storyboard workbook: ${written}`);
}

async function cmdAnalyze(args) {
  const [input] = args;
  if (!input) fail('analyze requires a project file');
  const runtime = getAnalysisRuntimeConfig();
  if (!runtime.apiKey) fail('Missing AIMM_LLM_API_KEY or OPENAI_API_KEY for script analysis');
  const doc = await loadAimovieFile(input);
  const result = await analyzeProjectDocument(doc);
  const written = await saveAimovieFile(input, doc);
  console.log(JSON.stringify({
    project: written,
    title: doc.project.title,
    promptPreset: doc.project.settings?.promptPreset || 'zh',
    model: result.runtime.model,
    baseUrl: result.runtime.baseUrl,
    counts: {
      characters: doc.project.characters.length,
      props: doc.project.props.length,
      scenes: doc.project.scenes.length,
      shorts: doc.project.shorts.length,
    },
  }, null, 2));
}

async function cmdPromptAnalyze(args) {
  const [input] = args;
  if (!input) fail('prompt-analyze requires a project file');
  const doc = await loadAimovieFile(input);
  const prompt = await buildAnalyzePrompt(doc.project);
  console.log(JSON.stringify(prompt, null, 2));
}

async function cmdSetStage(args) {
  const [input, pipelineStage, status] = args;
  if (!input || !pipelineStage) fail('set-stage requires <project> <pipelineStage> [status]');
  const doc = await loadAimovieFile(input);
  setProjectStage(doc, pipelineStage, status);
  const written = await saveAimovieFile(input, doc);
  console.log(`Updated stage: ${written} -> ${pipelineStage}${status ? ` (${status})` : ''}`);
}

async function cmdSetShotStatus(args) {
  const [input, shotOrder, status, videoUrl] = args;
  if (!input || !shotOrder || !status) fail('set-shot-status requires <project> <shotOrder> <status> [videoUrl]');
  const doc = await loadAimovieFile(input);
  const shot = updateShotStatus(doc, shotOrder, {
    status,
    videoUrl,
    clearError: status === 'pending' || status === 'succeeded',
    clearTaskId: status === 'pending',
  });
  const written = await saveAimovieFile(input, doc);
  console.log(`Updated shot #${shot.order}: ${written} -> ${shot.status}`);
}

async function cmdGenImage(args) {
  const [input, scope = 'characters'] = args;
  if (!input) fail('gen-image requires <project> [scope]');
  const doc = await loadAimovieFile(input);
  const project = doc.project;
  const runtime = getImageRuntimeConfig();
  if (!runtime.apiKey) {
    fail('Missing AIMM_IMAGE_API_KEY or OPENAI_API_KEY for image generation');
  }
  project.settings = project.settings || {};
  project.settings.imageModel = runtime.model;
  project.settings.imageBaseUrl = runtime.baseUrl;
  project.pipelineStage = project.pipelineStage === 'draft' ? 'parsed' : project.pipelineStage;
  const results = await generateImagesForScope(project, scope);
  const succeeded = results.filter(item => item.status === 'succeeded').length;
  const failed = results.filter(item => item.status === 'failed').length;
  if (scope === 'picturebook') {
    if (succeeded > 0) project.pipelineStage = 'enhanced';
  } else if (succeeded > 0) {
    project.pipelineStage = 'enhanced';
  }
  if (failed > 0 && succeeded === 0) {
    project.status = 'editing';
  }
  const written = await saveAimovieFile(input, doc);
  console.log(JSON.stringify({ project: written, scope, succeeded, failed, results }, null, 2));
}

async function cmdGenVideo(args) {
  const [input, shotOrder] = args;
  if (!input || !shotOrder) fail('gen-video requires <project> <shotOrder>');
  const runtime = getVideoRuntimeConfig();
  if (!runtime.apiKey) fail('Missing AIMM_VIDEO_API_KEY or OPENAI_API_KEY for video generation');
  const doc = await loadAimovieFile(input);
  const shot = getShotByOrder(doc, shotOrder);
  const result = await submitVideoGeneration(shot, doc.project);
  doc.project.settings = doc.project.settings || {};
  doc.project.settings.model = shot.modelOverride || doc.project.settings.model || runtime.model;
  doc.project.settings.videoBaseUrl = runtime.baseUrl;
  shot.taskId = result.taskId;
  shot.status = 'running';
  shot.error = null;
  doc.project.status = 'generating';
  doc.project.pipelineStage = 'generating';
  const written = await saveAimovieFile(input, doc);
  console.log(JSON.stringify({
    project: written,
    shotOrder: Number(shot.order),
    taskId: result.taskId,
    model: result.request.model,
    duration: result.request.duration,
    ratio: result.request.ratio,
    hasImages: Array.isArray(result.request.images) && result.request.images.length > 0,
    hasVideos: Array.isArray(result.request.videos) && result.request.videos.length > 0,
    hasAudios: Array.isArray(result.request.audios) && result.request.audios.length > 0,
  }, null, 2));
}

async function cmdPollVideo(args) {
  const [input, shotOrder] = args;
  if (!input || !shotOrder) fail('poll-video requires <project> <shotOrder>');
  const runtime = getVideoRuntimeConfig();
  if (!runtime.apiKey) fail('Missing AIMM_VIDEO_API_KEY or OPENAI_API_KEY for video generation');
  const doc = await loadAimovieFile(input);
  const shot = getShotByOrder(doc, shotOrder);
  if (!shot.taskId) fail(`Shot #${shot.order} has no taskId`);
  const result = await fetchVideoTaskStatus(shot.taskId);
  shot.status = result.status;
  if (result.videoUrl) {
    shot.videoUrl = result.videoUrl;
    shot.sourceVideoUrl = result.videoUrl;
    shot.error = null;
    shot.videoCandidates = Array.isArray(shot.videoCandidates) ? shot.videoCandidates : [];
    if (!shot.videoCandidates.some(candidate => candidate.url === result.videoUrl)) {
      shot.videoCandidates.push({
        url: result.videoUrl,
        path: null,
        sourceUrl: result.videoUrl,
        createdAt: new Date().toISOString(),
      });
    }
  }
  if (result.status === 'failed') {
    shot.error = result.error?.message || result.error || 'Video generation failed';
  }
  if (result.status === 'succeeded' && result.videoUrl) {
    doc.project.pipelineStage = 'completed';
    doc.project.status = doc.project.shorts.every(item => item.status === 'succeeded' || item.status === 'failed')
      ? 'completed'
      : 'editing';
  } else if (result.status === 'running' || result.status === 'queued' || result.status === 'submitted') {
    doc.project.pipelineStage = 'generating';
    doc.project.status = 'generating';
  } else if (result.status === 'failed') {
    doc.project.status = 'editing';
  }
  const written = await saveAimovieFile(input, doc);
  console.log(JSON.stringify({
    project: written,
    shotOrder: Number(shot.order),
    taskId: shot.taskId,
    status: result.status,
    videoUrl: result.videoUrl,
    error: result.error || null,
  }, null, 2));
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  switch (command) {
    case 'create':
      await cmdCreate(args);
      return;
    case 'inspect':
      await cmdInspect(args);
      return;
    case 'agent-status':
      await cmdAgentStatus(args);
      return;
    case 'agent-cycle':
      await cmdAgentCycle(args);
      return;
    case 'import-aimovie':
      await cmdImportAimovie(args);
      return;
    case 'import-xlsx':
      await cmdImportXlsx(args);
      return;
    case 'analyze':
      await cmdAnalyze(args);
      return;
    case 'prompt-analyze':
      await cmdPromptAnalyze(args);
      return;
    case 'gen-video':
      await cmdGenVideo(args);
      return;
    case 'poll-video':
      await cmdPollVideo(args);
      return;
    case 'set-stage':
      await cmdSetStage(args);
      return;
    case 'set-shot-status':
      await cmdSetShotStatus(args);
      return;
    case 'gen-image':
      await cmdGenImage(args);
      return;
    default:
      fail(`unknown command "${command}"`);
  }
}

main().catch(error => fail(error.message || String(error)));
