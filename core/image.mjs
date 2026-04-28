const DEFAULT_IMAGE_BASE = process.env.AIMM_IMAGE_BASE || 'https://main-new.codesuc.top/v1';
const DEFAULT_IMAGE_MODEL = process.env.AIMM_IMAGE_MODEL || 'gpt-image-2';

function getApiKey() {
  return process.env.AIMM_IMAGE_API_KEY || process.env.OPENAI_API_KEY || '';
}

export function getImageRuntimeConfig() {
  return {
    apiKey: getApiKey(),
    baseUrl: DEFAULT_IMAGE_BASE,
    model: DEFAULT_IMAGE_MODEL,
  };
}

function getStyleInstruction(project) {
  const preset = project?.settings?.stylePreset || '3d-semirealistic';
  const styleMap = {
    '3d-semirealistic': '3D semi-realistic UE5 style, cinematic lighting, stable identity',
    'hyper-realistic-cgi': 'hyper-realistic CGI, studio lighting, skin texture with visible pores',
    'photorealistic': 'photorealistic live-action, cinematic film grain, realistic skin texture, shallow depth of field',
    'live-action': 'live-action real person, authentic facial anatomy, cinematic photography',
    '2d-anime': '2D anime style, cel-shaded, clean line art, vibrant flat colors'
  };
  return styleMap[preset] || '';
}

function aspectSizeFromRatio(ratio = '16:9') {
  if (ratio === '1:1') return '1024x1024';
  if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3') return '1024x1536';
  return '1536x1024';
}

async function generateImage({ prompt, size = '1024x1024', references = [] }) {
  const { apiKey, baseUrl, model } = getImageRuntimeConfig();
  if (!apiKey) throw new Error('Missing AIMM_IMAGE_API_KEY or OPENAI_API_KEY for image generation');

  const hasReferences = Array.isArray(references) && references.length > 0;
  const endpoint = hasReferences ? `${baseUrl}/images/edits` : `${baseUrl}/images/generations`;
  const body = hasReferences
    ? {
        model,
        prompt,
        images: references.slice(0, 16).map(url => ({ image_url: url })),
        n: 1,
        size,
        quality: 'medium'
      }
    : {
        model,
        prompt,
        n: 1,
        size,
        quality: 'medium'
      };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image API failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  const url = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  if (!url) throw new Error('Image API returned no image URL');
  return url;
}

function addImageCandidate(item, imageUrl) {
  item.imageCandidates = Array.isArray(item.imageCandidates) ? item.imageCandidates : [];
  if (!item.imageCandidates.some(candidate => candidate.url === imageUrl)) {
    item.imageCandidates.push({
      url: imageUrl,
      path: null,
      createdAt: new Date().toISOString()
    });
  }
  item.imageUrl = imageUrl;
}

export async function generateCharacterImageForProject(character, project) {
  const style = getStyleInstruction(project);
  const prompt = style
    ? `生成精致的人物形象, ${style}, 人物尽量占满, 除了角色外背景为纯白色, 生成完整的半身像(腰以上)。角色描述：${character.description || character.name}`
    : `生成精致的人物形象, 人物尽量占满, 除了角色外背景为纯白色, 生成完整的半身像(腰以上)。角色描述：${character.description || character.name}`;
  const url = await generateImage({ prompt, size: '1024x1536' });
  addImageCandidate(character, url);
  return url;
}

export async function generateSceneImageForProject(scene, project) {
  const style = getStyleInstruction(project);
  const prompt = style
    ? `生成场景图片, ${style}, 镜头尽量在适合拍照打卡的角度, 不要有人物, Image should NOT include human, just scene。场景描述：${scene.description || scene.name}`
    : `生成场景图片, 镜头尽量在适合拍照打卡的角度, 不要有人物, Image should NOT include human, just scene。场景描述：${scene.description || scene.name}`;
  const url = await generateImage({ prompt, size: '1536x1024' });
  addImageCandidate(scene, url);
  return url;
}

export async function generatePropImageForProject(prop, project) {
  const style = getStyleInstruction(project);
  const prompt = style
    ? `生成精致的道具物品图片, ${style}, 物品尽量占满画面, 背景为纯白色, 展示完整的物品细节。道具描述：${prop.description || prop.name}`
    : `生成精致的道具物品图片, 物品尽量占满画面, 背景为纯白色, 展示完整的物品细节。道具描述：${prop.description || prop.name}`;
  const url = await generateImage({ prompt, size: '1024x1024' });
  addImageCandidate(prop, url);
  return url;
}

export async function generatePicturebookForShot(shot, project) {
  const style = getStyleInstruction(project);
  const ratio = shot.ratio || project?.settings?.ratio || '16:9';
  const size = aspectSizeFromRatio(ratio);
  const refs = [];
  const scene = (project.scenes || []).find(item => item.id === shot.sceneId);
  if (scene?.imageUrl) refs.push(scene.imageUrl);
  for (const characterId of shot.characterIds || []) {
    const character = (project.characters || []).find(item => item.id === characterId);
    const ref = (character?.anchorVerified && character?.anchorImageUrl) ? character.anchorImageUrl : character?.imageUrl;
    if (ref) refs.push(ref);
  }
  for (const propId of shot.propIds || []) {
    const prop = (project.props || []).find(item => item.id === propId);
    const ref = (prop?.anchorVerified && prop?.anchorImageUrl) ? prop.anchorImageUrl : prop?.imageUrl;
    if (ref) refs.push(ref);
  }
  for (const url of shot.imageUrls || []) if (url) refs.push(url);

  const context = [];
  if (scene?.description) context.push(`场景：${scene.description}`);
  for (const characterId of shot.characterIds || []) {
    const character = (project.characters || []).find(item => item.id === characterId);
    if (character) context.push(`角色 ${character.name}：${character.description || ''}`);
  }
  const ratioHint = ratio === '9:16' ? '竖幅构图(9:16)' : ratio === '1:1' ? '方形构图(1:1)' : '宽幅构图(16:9)';
  const prompt = style
    ? `生成绘本风格的插画, ${style}, ${ratioHint}, 画面精美细腻, 适合作为故事绘本的一页。${context.join('；')}。画面描述：${shot.prompt || ''}`
    : `生成精美的绘本风格插画, ${ratioHint}, 画面精美细腻, 适合作为故事绘本的一页。${context.join('；')}。画面描述：${shot.prompt || ''}`;
  const url = await generateImage({ prompt, size, references: refs });
  shot.picturebookUrl = url;
  shot.picturebookStatus = 'succeeded';
  shot.picturebookError = null;
  return url;
}

export async function generateImagesForScope(project, scope) {
  const normalized = scope || 'characters';
  const results = [];

  if (normalized === 'characters') {
    for (const character of project.characters || []) {
      if (!character.description) continue;
      try {
        const url = await generateCharacterImageForProject(character, project);
        results.push({ type: 'character', name: character.name, status: 'succeeded', url });
      } catch (error) {
        results.push({ type: 'character', name: character.name, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  if (normalized === 'scenes') {
    for (const scene of project.scenes || []) {
      if (!scene.description) continue;
      try {
        const url = await generateSceneImageForProject(scene, project);
        results.push({ type: 'scene', name: scene.name, status: 'succeeded', url });
      } catch (error) {
        results.push({ type: 'scene', name: scene.name, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  if (normalized === 'props') {
    for (const prop of project.props || []) {
      if (!prop.description) continue;
      try {
        const url = await generatePropImageForProject(prop, project);
        results.push({ type: 'prop', name: prop.name, status: 'succeeded', url });
      } catch (error) {
        results.push({ type: 'prop', name: prop.name, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  if (normalized === 'picturebook') {
    for (const shot of project.shorts || []) {
      try {
        shot.picturebookStatus = 'running';
        const url = await generatePicturebookForShot(shot, project);
        results.push({ type: 'shot', name: `#${shot.order}`, status: 'succeeded', url });
      } catch (error) {
        shot.picturebookStatus = 'failed';
        shot.picturebookError = error.message;
        results.push({ type: 'shot', name: `#${shot.order}`, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  throw new Error(`Unsupported image scope: ${scope}`);
}
