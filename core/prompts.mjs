import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const PROMPT_PRESETS = {
  zh: { file: 'ZH_default.md' },
  'zh-interactive': { file: 'ZH_interactive.md', base: 'zh' },
  'zh-long-interactive': { file: 'ZH_long_interactive.md', base: 'zh' },
  en: { file: 'EN_default.md' },
  'zh-picturebook': { file: 'ZH_picturebook.md', base: 'zh' },
  'zh-shortdrama': { file: 'ZH_shortdrama.md', base: 'zh' },
  'zh-ad': { file: 'ZH_ad.md', base: 'zh' },
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(MODULE_DIR, '../AIMovieMakerWorkspace/prompts');
const cache = new Map();

function parsePresetMarkdown(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const prompts = {};
  let currentTask = null;
  let buffer = [];

  const flush = () => {
    if (currentTask) {
      prompts[currentTask] = buffer.join('\n').trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^#\s+(\S+)\s*$/);
    if (match) {
      flush();
      currentTask = match[1];
      continue;
    }
    if (!currentTask) continue;
    buffer.push(line);
  }
  flush();
  return prompts;
}

async function loadPreset(presetKey = 'zh') {
  if (cache.has(presetKey)) return cache.get(presetKey);
  const meta = PROMPT_PRESETS[presetKey];
  if (!meta) throw new Error(`Unknown prompt preset: ${presetKey}`);
  const filePath = path.join(PROMPTS_DIR, meta.file);
  const raw = await fs.readFile(filePath, 'utf8');
  const ownPrompts = parsePresetMarkdown(raw);
  const basePrompts = meta.base ? await loadPreset(meta.base) : {};
  const merged = { ...basePrompts, ...ownPrompts };
  cache.set(presetKey, merged);
  return merged;
}

export async function getPrompt(taskName, presetKey = 'zh') {
  const prompts = await loadPreset(presetKey);
  const prompt = prompts[taskName];
  if (!prompt) {
    throw new Error(`Prompt task "${taskName}" not found in preset "${presetKey}"`);
  }
  return prompt;
}
