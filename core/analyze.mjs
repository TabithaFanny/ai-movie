import { getPrompt } from './prompts.mjs';
import { applyBreakdownToProject } from './project.mjs';

const DEFAULT_ANALYSIS_BASE = process.env.AIMM_LLM_BASE || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_ANALYSIS_MODEL = process.env.AIMM_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function getApiKey() {
  return process.env.AIMM_LLM_API_KEY || process.env.OPENAI_API_KEY || '';
}

export function getAnalysisRuntimeConfig() {
  return {
    apiKey: getApiKey(),
    baseUrl: DEFAULT_ANALYSIS_BASE,
    model: DEFAULT_ANALYSIS_MODEL,
  };
}

function getLanguageInstruction(langCode) {
  const lang = String(langCode || 'zh').toLowerCase();
  if (lang.startsWith('en')) return '\n\nUse English for all JSON text fields.';
  if (lang.startsWith('ja')) return '\n\nすべての JSON テキストフィールドは日本語で出力してください。';
  return '\n\n所有 JSON 文本字段请使用中文输出。';
}

function getSubtitleInstruction(includeNarration, includeDialogue) {
  if (!includeNarration && !includeDialogue) return '';
  const parts = ['\n\nAdditionally, for EACH short clip in the "shorts" array, include the following extra field(s):'];
  if (includeNarration) {
    parts.push('- "narration": a concise off-screen voice-over line that fits the clip duration. Use empty string when unnecessary.');
  }
  if (includeDialogue) {
    parts.push('- "dialogue": the spoken line by the on-screen actor in this clip. Use empty string when unnecessary.');
  }
  return parts.join('\n');
}

function extractJson(text) {
  let jsonStr = String(text || '').trim();
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();
  return JSON.parse(jsonStr);
}

export async function buildAnalyzePrompt(project) {
  const promptPreset = project?.settings?.promptPreset || 'zh';
  const totalDuration = Number(project?.totalDuration || 3);
  const episodeCount = Math.max(1, Number(project?.episodeCount || 1));
  const langCode = project?.settings?.narrationLanguage || 'zh';
  const options = {
    includeNarration: !!project?.settings?.includeNarration,
    includeDialogue: !!project?.settings?.includeDialogue,
  };

  let episodeInstr = '';
  if (episodeCount > 1) {
    episodeInstr = `\n\nThe movie has ${episodeCount} episodes. Each short MUST include an "episode" field (integer 1-${episodeCount}).`;
  }

  const systemPrompt = `${await getPrompt('scriptAnalysis', promptPreset)}${episodeInstr}${getSubtitleInstruction(options.includeNarration, options.includeDialogue)}${getLanguageInstruction(langCode)}`;
  const userMessage = `Total movie duration: ${totalDuration} minutes.${episodeCount > 1 ? ` Total episodes: ${episodeCount}.` : ''}\n\nScript:\n${project?.script || ''}`;
  return { systemPrompt, userMessage, promptPreset };
}

export async function analyzeScriptWithLLM(project) {
  const runtime = getAnalysisRuntimeConfig();
  if (!runtime.apiKey) {
    throw new Error('Missing AIMM_LLM_API_KEY or OPENAI_API_KEY for script analysis');
  }
  if (!project?.script?.trim()) {
    throw new Error('Project script is empty');
  }

  const { systemPrompt, userMessage, promptPreset } = await buildAnalyzePrompt(project);
  const response = await fetch(`${runtime.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: runtime.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Analysis API failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Analysis API returned empty content');

  return {
    runtime,
    promptPreset,
    breakdown: extractJson(content),
    rawContent: content,
  };
}

export async function analyzeProjectDocument(document) {
  const project = document?.project;
  const result = await analyzeScriptWithLLM(project);
  project.settings = project.settings || {};
  project.settings.chatModel = result.runtime.model;
  project.settings.analysisBaseUrl = result.runtime.baseUrl;
  project.settings.promptPreset = result.promptPreset;
  applyBreakdownToProject(document, result.breakdown);
  return result;
}
