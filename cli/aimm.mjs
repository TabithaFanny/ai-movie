#!/usr/bin/env node

import path from 'path';
import { createProject, describeProject, loadAimovieFile, saveAimovieFile } from '../core/project.mjs';

function usage() {
  console.log(`AIMM CLI

Usage:
  aimm create <title> [output]
  aimm inspect <project.aimovie.md>
  aimm import-aimovie <input.aimovie.md> [output]
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
    default:
      fail(`unknown command "${command}"`);
  }
}

main().catch(error => fail(error.message || String(error)));
