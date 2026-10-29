/**
 * Official documentation checked 2026-10-29. Central.ai has no connected video API.
 * Drafts below are the Central.ai normalized contract, NOT provider request bodies.
 */
const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const checkedAt = '2026-10-29';

export const MODELS = Object.freeze([
  {
    id: 'seedance-2.5', name: 'Seedance 2.5', provider: 'ByteDance · 火山方舟',
    tag: '推荐', color: '#ccff70', description: '多模态参考与原生音画，支持最长 30 秒。',
    durations: range(4, 30), resolutions: ['480p', '720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    inputs: ['text', 'image', 'video', 'audio'], maxImageReferences: 30,
    sourceUrl: 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '模型 ID 需在开通账户后核对；编辑视频有独立时长限制。本站尚未接入。',
  },
  {
    id: 'seedance-2.0', name: 'Seedance 2.0', provider: 'ByteDance · 火山方舟',
    tag: '多模态', color: '#f2c27b', description: '支持多图、视频与音频参考，30 秒场次需分段。',
    durations: range(4, 15), resolutions: ['480p', '720p', '1080p', '4k'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    inputs: ['text', 'image', 'video', 'audio'], maxImageReferences: 9,
    sourceUrl: 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '本项为标准版；fast / mini 分辨率限制不同。不能仅传音频。',
  },
  {
    id: 'kling-4.0', name: 'Kling 4.0', provider: 'Kuaishou · 可灵',
    tag: 'NEW', color: '#a2abff', description: '原生 30 秒、多关键帧与 Omni 参考创作。',
    durations: range(3, 30), resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '21:9'],
    inputs: ['text', 'image', 'video', 'audio'], maxImageReferences: 10,
    sourceUrl: 'https://kling.ai/document-api/updates/api?date=2026-02-11',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '官方 2026-10-28 发布 API；4K 仍为即将推出，暂不提供。',
  },
  {
    id: 'veo-3.1', name: 'Veo 3.1', provider: 'Google Cloud',
    tag: '原生音频', color: '#8ebdff', description: 'Cloud GA 入口，支持首尾帧、资产参考与声音。',
    durations: [4, 6, 8], resolutions: ['720p', '1080p'], ratios: ['16:9', '9:16'],
    inputs: ['text', 'image'], maxImageReferences: 3,
    sourceUrl: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate?hl=en',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '采用 Cloud GA；Gemini Developer API 的旧 Preview 已关闭。参考图仅支持 8 秒；1080p 保守限制为 8 秒。',
    providerModelId: 'veo-3.1-generate-001',
  },
  {
    id: 'runway-gen4.5', name: 'Runway Gen-4.5', provider: 'Runway',
    tag: '镜头控制', color: '#e4a8f8', description: '文生与图生，适合逐镜头运动与构图探索。',
    durations: range(2, 10), resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    taskRatios: { text: ['16:9'], image: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
    inputs: ['text', 'image'], maxImageReferences: 1,
    sourceUrl: 'https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '官方产品规格：文生仅 16:9；图生支持多种画幅。精确 API ratio 枚举接入时复核。',
  },
  {
    id: 'wan-2.7', name: 'Wan 2.7', provider: 'Alibaba Cloud · 通义万相',
    tag: '多镜叙事', color: '#8ddcc4', description: '文生视频与时间标记多镜叙事，支持音频输入。',
    durations: range(2, 15), resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'], inputs: ['text', 'audio'], maxImageReferences: 0,
    sourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference',
    checkedAt, status: 'not_connected', disabled: false,
    notes: '本项仅核验 wan2.7-t2v 文生 API，不移植其他 Wan 型号的参考能力。',
  },
  {
    id: 'sora-2', name: 'Sora 2', provider: 'OpenAI',
    tag: '已停服', color: '#868c96', description: '历史模型；官方 API 已于 2026-09-24 关闭。',
    durations: [], resolutions: [], ratios: [], inputs: [], maxImageReferences: 0,
    sourceUrl: 'https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation',
    checkedAt, status: 'discontinued', disabled: true,
    notes: '仅保留历史说明，不允许创建提交草稿。',
  },
]);

export function getModel(id = 'seedance-2.5') {
  return MODELS.find(model => model.id === id);
}

function requireModel(id) {
  const model = getModel(id);
  if (!model) throw new TypeError(`未知视频模型：${id}`);
  if (model.disabled || model.status === 'discontinued') throw new TypeError(`${model.name} 已停服，不能创建视频任务。`);
  return model;
}

function referenceMetadata(reference, index) {
  if (!reference || typeof reference !== 'object') throw new TypeError(`参考 ${index + 1} 缺少文件元数据。`);
  const source = reference.file && typeof reference.file === 'object' ? reference.file : reference;
  const name = typeof source.name === 'string' ? source.name : reference.fileName;
  if (typeof name !== 'string' || !name.trim()) throw new TypeError(`参考 ${index + 1} 缺少文件名。`);
  const mimeType = source.mimeType || ((source.type || '').includes('/') ? source.type : '');
  if (mimeType && !/^image\//.test(mimeType)) throw new TypeError(`参考 ${name} 必须是图片。`);
  return {
    id: typeof reference.id === 'string' ? reference.id : `reference-${index + 1}`,
    name: name.trim(), mimeType: mimeType || 'image/unknown',
    ...(Number.isFinite(source.size) && source.size >= 0 ? { size: source.size } : {}),
    ...(Number.isFinite(source.lastModified) ? { lastModified: source.lastModified } : {}),
    uploadStatus: 'pending',
  };
}

/** Validate a draft without network calls, uploading references, or creating a job. */
export function buildVideoDraft({ modelId = 'seedance-2.5', prompt, duration, ratio, resolution,
  taskType = 'text', references = [], projectId = null } = {}) {
  const model = requireModel(modelId);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('请输入视频提示词。');
  if (!['text', 'image'].includes(taskType) || !model.inputs.includes(taskType))
    throw new TypeError(`${model.name} 当前核验的接口不支持此输入类型。`);
  if (!Number.isInteger(duration) || !model.durations.includes(duration))
    throw new RangeError(`${model.name} 不支持 ${duration} 秒，请按模型可用时长选择。`);
  const ratios = model.taskRatios?.[taskType] || model.ratios;
  if (!ratios.includes(ratio)) throw new RangeError(`${model.name} 的${taskType === 'text' ? '文生' : '图生'}模式不支持 ${ratio} 画幅。`);
  if (!model.resolutions.includes(resolution)) throw new RangeError(`${model.name} 不支持 ${resolution} 分辨率。`);
  if (!Array.isArray(references)) throw new TypeError('参考图片必须是数组。');
  if (taskType === 'image' && !references.length) throw new TypeError('图生模式至少需要一张参考图片。');
  if (taskType === 'text' && references.length) throw new TypeError('使用参考图片时请选择图生模式。');
  if (references.length > model.maxImageReferences) throw new RangeError(`${model.name} 当前模式最多记录 ${model.maxImageReferences} 张参考图片。`);
  if (model.id === 'veo-3.1' && (references.length || resolution === '1080p') && duration !== 8)
    throw new RangeError('Veo 3.1 使用参考图或 1080p 时请选择 8 秒。');
  const metadata = references.map(referenceMetadata);
  return {
    status: 'not_submitted', submitted: false,
    contract: 'central.ai/video-draft',
    payload: {
      schemaVersion: '1.0.0', projectId, provider: model.provider, modelId: model.id,
      taskType, prompt: prompt.trim(), duration, ratio, resolution,
      references: metadata, referenceUploadStatus: metadata.length ? 'pending' : 'not_required',
    },
    warnings: [
      'API 待接入；这是 Central.ai 通用请求草稿，不是厂商 API 请求体，未提交生成。',
      ...(metadata.length ? ['参考仅包含文件元数据；图片尚未上传，接入后需要重新上传并获取真实素材 ID。'] : []),
      '原台词的逐字声音与口型仍需生成后审核；摄影描述是创作意图。',
    ],
    modelSource: { sourceUrl: model.sourceUrl, checkedAt: model.checkedAt },
  };
}

function shotText(shot, start, end) {
  const camera = shot.camera || {};
  const dialogue = (shot.dialogue || []).map(line => `${line.speaker}逐字说：“${line.text}”`).join('；') || '无对白';
  return `[${start}–${end}秒]${shot.prefix || '沿用本场风格'}；${shot.scale || ''}；${shot.movement || ''}、${shot.angle || ''}，${camera.focal_mm || ''}mm，f/${camera.aperture || ''}，焦点${camera.focus || ''}，机位高${camera.height_m ?? ''}m，${camera.motion_detail || ''}；${shot.content || ''}；${shot.action || ''}；${shot.lighting || ''}；${shot.emotion || ''}，${dialogue}，${shot.sound || ''}。`;
}

/**
 * Partition at existing shot boundaries using exact supported durations.
 * Dynamic programming avoids a short unrenderable tail left by greedy grouping.
 * On failure, the original shots remain untouched; no padding or invented shots.
 */
export function splitSceneForModel(scene, modelId = 'seedance-2.5') {
  const model = requireModel(modelId);
  const shots = Array.isArray(scene?.shots) ? scene.shots : [];
  const result = { supported: false, modelId, originalDuration: 0, segments: [], errors: [], warnings: [] };
  if (!shots.length) { result.errors.push('场次缺少分镜。'); return result; }
  let cursor = 0;
  for (const shot of shots) {
    if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.start !== cursor || shot.end <= shot.start) {
      result.errors.push('镜头时间必须从 0 秒连续排列且无重叠。'); return result;
    }
    cursor = shot.end;
  }
  result.originalDuration = cursor;
  // Fewest segments, preferring longer earlier segments. Discrete durations matter.
  const best = new Array(shots.length + 1).fill(null);
  best[shots.length] = [];
  for (let i = shots.length - 1; i >= 0; i--) {
    for (let j = shots.length; j > i; j--) {
      const duration = shots[j - 1].end - shots[i].start;
      if (!model.durations.includes(duration) || best[j] === null) continue;
      const candidate = [[i, j], ...best[j]];
      if (!best[i] || candidate.length < best[i].length) best[i] = candidate;
    }
  }
  if (!best[0]) {
    result.errors.push(`无法在保留全部镜头与原时长的前提下适配 ${model.name}。请人工调整分镜边界或切换模型；未补拍、未裁剪。`);
    if (cursor < model.durations[0]) result.errors.push(`本场 ${cursor} 秒短于模型最短 ${model.durations[0]} 秒。`);
    return result;
  }
  // Retain the self-contained identity/location header from the source compiler.
  const sourceHeader = typeof scene.prompt === 'string'
    ? scene.prompt.split(/\[\d{1,3}[–—-]\d{1,3}秒\]/)[0].replace(/^\d+\s*秒连续叙事生产单元[，,]?\s*/, '')
    : '';
  result.segments = best[0].map(([from, to], index) => {
    const selected = shots.slice(from, to);
    const sourceStart = selected[0].start;
    const sourceEnd = selected.at(-1).end;
    const duration = sourceEnd - sourceStart;
    const state = index === 0
      ? scene.opening_state || '按原场初始状态执行'
      : `承接原场 ${sourceStart} 秒处的动作、人物位置、视线、服装与道具状态；先确认上一子段末帧后再提交。`;
    const prompt = `${duration} 秒执行子段，原场 ${scene.id || ''} 的 ${sourceStart}–${sourceEnd} 秒。${sourceHeader}本子段开始状态：${state}。${selected.map(shot => shotText(shot, shot.start - sourceStart, shot.end - sourceStart)).join('')}连续性约束：${scene.continuity_constraints || '保持人物、服装、空间、主光和道具状态连续'}。`;
    return { id: `${scene.id || 'scene'}-part-${index + 1}`, sourceStart, sourceEnd, duration,
      shots: selected.map(shot => ({ ...shot, camera: shot.camera ? { ...shot.camera } : undefined,
        dialogue: (shot.dialogue || []).map(line => ({ ...line })) })),
      openingState: state, prompt };
  });
  result.supported = true;
  if (result.segments.length > 1) result.warnings.push('已按原镜头边界拆分；完整母场保留。各子段衔接、参考末帧与声音连续性须人工审核。');
  result.warnings.push('仅时长匹配；实际画幅、分辨率、参考和任务类型仍由草稿校验。');
  return result;
}
