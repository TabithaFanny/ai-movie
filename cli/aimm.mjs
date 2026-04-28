#!/usr/bin/env node

import path from 'path';
import {
  createProject,
  createProjectFromStoryboardRows,
  describeProject,
  loadAimovieFile,
  readStoryboardWorkbook,
  saveAimovieFile,
  setProjectStage,
  updateShotStatus,
} from '../core/project.mjs';
import { analyzeProjectDocument, buildAnalyzePrompt, getAnalysisRuntimeConfig } from '../core/analyze.mjs';
import { generateImagesForScope, getImageRuntimeConfig } from '../core/image.mjs';

function usage() {
  console.log(`AIMM CLI

Usage:
  aimm create <title> [output]
  aimm inspect <project.aimovie.md>
  aimm import-aimovie <input.aimovie.md> [output]
  aimm import-xlsx <storyboard.xlsx> [output]
  aimm analyze <project.aimovie.md>
  aimm prompt-analyze <project.aimovie.md>
  aimm set-stage <project.aimovie.md> <pipelineStage> [status]
  aimm set-shot-status <project.aimovie.md> <shotOrder> <status> [videoUrl]
  aimm gen-image <project.aimovie.md> [scope]
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
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
