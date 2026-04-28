const DEFAULT_VIDEO_BASE = process.env.AIMM_VIDEO_BASE || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_VIDEO_MODEL = process.env.AIMM_VIDEO_MODEL || 'seedance-2.0-fast';
const DEFAULT_VIDEO_SUBMIT_PATH = process.env.AIMM_VIDEO_SUBMIT_PATH || '/videos/generations';
const DEFAULT_VIDEO_STATUS_TEMPLATE = process.env.AIMM_VIDEO_STATUS_TEMPLATE || '/videos/generations/{taskId}';

function getApiKey() {
  return process.env.AIMM_VIDEO_API_KEY || process.env.OPENAI_API_KEY || '';
}

export function getVideoRuntimeConfig() {
  return {
    apiKey: getApiKey(),
    baseUrl: DEFAULT_VIDEO_BASE,
    model: DEFAULT_VIDEO_MODEL,
    submitPath: DEFAULT_VIDEO_SUBMIT_PATH,
    statusTemplate: DEFAULT_VIDEO_STATUS_TEMPLATE,
  };
}

function createImageRef(url, role) {
  const normalized = String(url || '').trim();
  if (!normalized) return null;
  return { url: normalized, role };
}

function buildVideoPrompt(shot, project) {
  const imageLabels = [];
  const images = [];
  const useKeyframes = !!(shot.firstFrameUrl || shot.lastFrameUrl);

  if (useKeyframes) {
    const firstFrame = createImageRef(shot.firstFrameUrl, 'first_frame');
    const lastFrame = createImageRef(shot.lastFrameUrl, 'last_frame');
    if (firstFrame) images.push(firstFrame);
    if (lastFrame) images.push(lastFrame);
  } else {
    const scene = (project.scenes || []).find(item => item.id === shot.sceneId);
    const sceneImage = createImageRef(scene?.imageUrl, 'reference_image');
    if (sceneImage) {
      images.push(sceneImage);
      imageLabels.push(scene?.name || '场景');
    }

    for (const characterId of shot.characterIds || []) {
      const character = (project.characters || []).find(item => item.id === characterId);
      const imageUrl = (character?.anchorVerified && character?.anchorImageUrl) ? character.anchorImageUrl : character?.imageUrl;
      const ref = createImageRef(imageUrl, 'reference_image');
      if (ref) {
        images.push(ref);
        imageLabels.push(character?.name || '角色');
      }
    }

    for (const propId of shot.propIds || []) {
      const prop = (project.props || []).find(item => item.id === propId);
      const imageUrl = (prop?.anchorVerified && prop?.anchorImageUrl) ? prop.anchorImageUrl : prop?.imageUrl;
      const ref = createImageRef(imageUrl, 'reference_image');
      if (ref) {
        images.push(ref);
        imageLabels.push(prop?.name || '道具');
      }
    }

    for (const url of shot.imageUrls || []) {
      const ref = createImageRef(url, 'reference_image');
      if (ref) images.push(ref);
    }
  }

  let prompt = String(shot.prompt || '').trim();
  if (imageLabels.length > 0 && !prompt.includes('参考图：')) {
    const line = `参考图：${imageLabels.map((label, index) => `${label}(图片${index + 1})`).join(', ')}`;
    prompt = prompt ? `${prompt}\n${line}` : line;
  }
  if (shot.dialogue && !prompt.includes(shot.dialogue)) {
    prompt = prompt
      ? `${prompt}\n角色台词 (Actor speaks aloud, lip-synced): "${shot.dialogue.trim()}"`
      : `角色台词 (Actor speaks aloud, lip-synced): "${shot.dialogue.trim()}"`;
  }

  const videos = [];
  if (shot.referenceVideoUrl) {
    videos.push({ url: shot.referenceVideoUrl, role: 'reference_video' });
  }

  const audios = (shot.audioUrls || []).filter(Boolean).map(url => ({ url, role: 'reference_audio' }));

  return {
    prompt,
    images,
    videos,
    audios,
  };
}

function normalizeStatusPayload(data) {
  return {
    id: data?.id || data?.task_id || data?.taskId || null,
    status: data?.status || data?.state || data?.task_status || 'unknown',
    videoUrl: data?.videoUrl || data?.video_url || data?.output_url || data?.url || null,
    duration: data?.duration || data?.video_duration || null,
    usage: data?.usage || null,
    error: data?.error || data?.last_error || null,
    raw: data,
  };
}

export async function submitVideoGeneration(shot, project) {
  const runtime = getVideoRuntimeConfig();
  if (!runtime.apiKey) throw new Error('Missing AIMM_VIDEO_API_KEY or OPENAI_API_KEY for video generation');
  if (!shot?.prompt?.trim()) throw new Error(`Shot #${shot?.order || '?'} prompt is empty`);

  const prepared = buildVideoPrompt(shot, project);
  const body = {
    model: shot.modelOverride || project?.settings?.model || runtime.model,
    prompt: prepared.prompt,
    resolution: project?.settings?.resolution || '720p',
    ratio: shot.ratio || project?.settings?.ratio || '16:9',
    duration: Number(shot.duration || project?.settings?.defaultDuration || 5),
    generate_audio: shot.generateAudioOverride ?? project?.settings?.generateAudio ?? true,
    watermark: !!shot.watermark,
  };
  if (prepared.images.length > 0) body.images = prepared.images;
  if (prepared.videos.length > 0) body.videos = prepared.videos;
  if (prepared.audios.length > 0) body.audios = prepared.audios;

  const response = await fetch(`${runtime.baseUrl.replace(/\/+$/, '')}${runtime.submitPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Video API submit failed at ${runtime.submitPath}: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  const taskId = data?.id || data?.task_id || data?.taskId || data?.data?.id || data?.data?.task_id || data?.data?.taskId;
  if (!taskId) throw new Error('Video API returned no task id');

  return {
    taskId,
    request: body,
    raw: data,
    runtime,
  };
}

export async function fetchVideoTaskStatus(taskId) {
  const runtime = getVideoRuntimeConfig();
  if (!runtime.apiKey) throw new Error('Missing AIMM_VIDEO_API_KEY or OPENAI_API_KEY for video generation');
  if (!taskId) throw new Error('Missing video task id');

  const statusPath = runtime.statusTemplate.replace('{taskId}', encodeURIComponent(String(taskId)));
  const response = await fetch(`${runtime.baseUrl.replace(/\/+$/, '')}${statusPath}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Video API status failed at ${statusPath}: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  return normalizeStatusPayload(data?.data || data);
}
