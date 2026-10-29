/**
 * Central.ai local workflow compiler.
 * This module does not call a model or generate images. Its output is an editable
 * structure preview, explicitly marked demo until a server provider is connected.
 */
export const ENGINE_VERSION = '1.0.0';
export const MODES = Object.freeze({
  characters: { label: '角色资产', outputs: ['characters'] },
  props: { label: '道具资产', outputs: ['props'] },
  prompts: { label: 'AI 提示词', outputs: ['characters', 'locations', 'props', 'video-prompts'] },
  full: { label: '完整创作包', outputs: ['characters', 'locations', 'props', 'video-prompts'] },
});

const SCALES = new Set(['远景', '全景', '中景', '近景', '特写', '大特写']);
const MOVEMENTS = new Set(['推', '拉', '摇', '移', '跟', '固定']);
const ANGLES = new Set(['平视', '俯拍', '仰拍']);
const SHOT_LENGTHS = [3, 4, 4, 4, 5, 5, 5];
const NOTICE = '本地演示 · 生成服务待接入。以下为可编辑的工作流与提示词结构预览，不是 AI 创作结果；图片和视频均未生成。';
const pad = (value, width = 2) => String(value).padStart(width, '0');
const text = (value) => typeof value === 'string' ? value.trim() : '';
const oneLine = (value) => String(value ?? '').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
const escapeCell = (value) => oneLine(value).replace(/\|/g, '\\|');

function normaliseReferences(references = []) {
  const list = Array.isArray(references) ? references : Object.entries(references).flatMap(([kind, items]) =>
    (Array.isArray(items) ? items : items ? [items] : []).map(item => typeof item === 'string' ? { name: item, type: kind } : { ...item, type: item.type || kind }));
  return list.map((item, index) => {
    if (typeof item === 'string') item = { name: item };
    return {
      id: text(item.id) || `R${pad(index + 1, 3)}`,
      type: text(item.type || item.kind) || 'reference',
      name: text(item.name || item.fileName) || `参考 ${index + 1}`,
      // Preserve source metadata, never represent uploaded pixels as inspected/generated.
      ...(typeof item.url === 'string' && /^https?:\/\//.test(item.url) ? { url: item.url } : {}),
      evidence: '用户选择的参考；未送入生成服务，未做视觉审核',
    };
  });
}

function normaliseDefinitions(items, fallback) {
  if (!Array.isArray(items) || !items.length) return [fallback];
  return items.map((item, i) => typeof item === 'string'
    ? { name: item, description: item }
    : { ...item, name: text(item.name) || `${fallback.name} ${i + 1}`, description: text(item.description) || text(item.name) || fallback.description });
}

function makeAsset(kind, definition, index, referenceList, ratio, style, requestedOutputs) {
  const prefix = { characters: 'C', locations: 'L', props: 'P' }[kind];
  const id = `${prefix}${pad(index + 1, 3)}`;
  const name = text(definition.name);
  const description = text(definition.description);
  const portraitReferences = referenceList.filter(r => /portrait|character|人像|角色/.test(r.type));
  const wardrobeReferences = referenceList.filter(r => /wardrobe|clothing|服装/.test(r.type));
  const relevantReferences = kind === 'characters'
    ? [...portraitReferences, ...wardrobeReferences]
    : referenceList.filter(r => /style|风格/.test(r.type));
  const identityReference = portraitReferences.length
    ? '身份参考仅用于人物脸部、发型和体态；服装模特的脸、身材与背景不进入身份设定。'
    : '虚构选角，人物具体五官、发型与体态须先确认；不用明星或网红面孔作为默认锚点。';
  const wardrobeReference = wardrobeReferences.length
    ? '服装参考仅用于领型、松量、肩线、门襟、口袋、袖口、衣长及面料视觉，保留有依据的结构。'
    : '服装款式待确认；未完成 1688 / Amazon / SHEIN 实款视觉匹配，不能声称同款复刻。';
  let prompt;
  if (kind === 'characters') {
    prompt = `${name}，${description}。${identityReference}${wardrobeReference}横向 16:9 单人物资产图，左侧约 40% 为正面胸像，右侧约 60% 为同一人的正面、严格 90° 侧面和背面全身；全身头脚完整，三视图尺度、头顶和脚底基线相容。灰白干净背景，中性柔和光，自然透视和正常肤色，保留少量自然不对称及生活痕迹；不做美妆高光或精修轮廓。只出现一个人物身份，五官关系、发际线、发型、身体比例和服装结构跨视角一致；无文字、标签、标尺、水印及额外人物。未确认的外貌和穿搭先由导演补充再送入生成。`;
  } else if (kind === 'locations') {
    prompt = `${style || '视觉风格待确认'}；${ratio}；固定主视角、35mm 自然空间透视。${name}，${description}。门窗、出口、家具、关键道具相对位置与材质按空间设定统一，灯光方向按确认后的视觉方案执行。只呈现独立可用的无人基础场景；没有真人、肢体、剪影、镜面或玻璃人影、人物海报、屏幕人脸、人体模型及人物壁画。不得用多宫格代替独立场景图；不写演员动作或运镜。`;
  } else {
    prompt = `单一道具资产：${name}，${description}。形状、几何结构、颜色、材质、合理比例、开合方式和必要标记待确认后保持一致；默认完整静置状态，完整入镜，轻接触影，中性柔和照明、干净灰白背景，自然透视。无人、无手、无肢体、无人像、无品牌水印及价格界面；不把互斥的开合或损坏状态合并为同一个状态。精确文字须保留原文，生成不稳定时在后期排字。`;
  }
  return {
    id, name, type: kind, description, prompt, negativePrompt: kind === 'characters'
      ? '多个人物身份、裁头裁脚、侧面朝向不清、服装结构变动、蜡皮、过度锐化、标签与标尺'
      : '人物、手部、肢体、人像海报、屏幕人脸、镜面人影、品牌水印、乱码',
    requested: requestedOutputs.includes(kind),
    status: 'prompt-ready', image: null, image_url: null,
    aspect_ratio: kind === 'characters' ? '16:9' : ratio,
    reference_ids: relevantReferences.map(r => r.id),
    evidence: relevantReferences.length ? '参考已记录，未提交给模型，未视觉审核' : '原创结构草案 / 待核验',
    review: { text: '仅结构校验', visual: '未生成图片，未做视觉审核' },
    assumptions: definition.provisional ? ['主题尚未被模型分析；这是待替换的资产槽位，不是已识别的故事资产。'] : [],
  };
}

function makeShots(sceneId, sceneIndex, assets, prefix, visualStyle) {
  const character = assets.characters[0].name;
  const prop = assets.props[0].name;
  const place = assets.locations[0].name;
  const plans = [
    { scale: '特写', movement: '固定', focal: 50, aperture: 4, distance: 0.8, focus: prop,
      content: `${place}内，${prop}占画面主要位置，${character}位于既定轴线同侧`,
      action: '展示与主题有关的关键物件当前状态；具体异常证据待导演根据大纲补写', purpose: '开头 3 秒的可见钩子槽位' },
    { scale: '中景', movement: '拉', focal: 35, aperture: 5.6, distance: 2.2, focus: character,
      content: `${character}与${prop}处于同一画面，交代两者距离及行动空间`,
      action: `${character}看向物件后停顿，保持画面方向；具体目标与阻力待补写`, purpose: '交代目标与空间关系' },
    { scale: '近景', movement: '固定', focal: 50, aperture: 4, distance: 1.5, focus: character,
      content: `${character}胸部以上构图，关键物件保持既定位置`,
      action: '角色吸气、调整视线后开始回应；实际回应对象和行动待根据大纲确定', purpose: '呈现冲突中的行动与反应' },
    { scale: '大特写', movement: '固定', focal: 85, aperture: 5.6, distance: 0.6, focus: prop,
      content: `${prop}的关键可见结构清晰入镜，背景保持先前空间方向`,
      action: '展示新增证据的可见细节；证据内容及是否开合待导演确认', purpose: '补充可验证的反转铺垫' },
    { scale: '全景', movement: '移', focal: 28, aperture: 5.6, distance: 3.2, focus: character,
      content: `${character}完整入镜，保留出口、家具和${prop}的相对位置`,
      action: '角色沿已交代的方向迈出一步后停止；具体局势变化待补写', purpose: '让信息升级改变人物行动' },
    { scale: '近景', movement: '推', focal: 50, aperture: 4, distance: 1.5, focus: character,
      content: `${character}与关键证据在既定轴线同侧，眼睛与证据均可辨`,
      action: '角色将视线从证据移向回应对象；反转的具体因果待导演确认', purpose: '完成有证据支撑的反转槽位' },
    { scale: '中景', movement: '固定', focal: 35, aperture: 5.6, distance: 2.2, focus: `${character}与${prop}`,
      content: `${place}内可见人物位置和物件归属，构图承接上一镜`,
      action: sceneIndex === 0 ? '角色停止动作，保留清楚的结束状态；本次故事的可见结果待补写' : '承接上场动作后停止，明确当前人物位置与物件状态；阶段结果待补写', purpose: '给出本场可见结果并记录连续性' },
  ];
  let start = 0;
  return plans.map((plan, i) => {
    const shot = {
      id: `${sceneId}-${pad(i + 1)}`, start, end: start + SHOT_LENGTHS[i],
      scale: plan.scale, movement: plan.movement, angle: '平视', prefix,
      camera: { focal_mm: plan.focal, aperture: plan.aperture, focus: plan.focus,
        height_m: plan.scale === '大特写' ? 1.1 : 1.5, distance_m: plan.distance,
        motion_detail: plan.movement === '固定' ? '机位固定，保持既定主轴与视线方向'
          : plan.movement === '拉' ? '从关键物件拉至人物与物件同框，终点揭示两者关系'
            : plan.movement === '移' ? '沿主轴同侧向右平移约 0.5 米，终点保留人物与出口关系'
              : '沿当前视线轴缓慢推近约 0.3 米，终点保持眼睛与证据清楚' },
      content: plan.content, action: plan.action,
      lighting: visualStyle ? `沿用已选视觉方向“${visualStyle}”；具体灯位、反差与色温待导演确认` : '光源、灯位和色温待用户确定视觉风格后补充',
      emotion: '自然呼吸，视线跟随可见事件；声音与表演强度待确认',
      sound: '无新增对白；环境声音方案待确认', purpose: plan.purpose, dialogue: [],
    };
    start = shot.end;
    return shot;
  });
}

function scheduleDialogue(project) {
  const shots = project.scenes.flatMap(scene => scene.shots);
  let shotIndex = 0;
  let used = 0;
  for (const line of project.locked_dialogue) {
    const characters = Array.from(line.text);
    let offset = 0;
    while (offset < characters.length) {
      if (shotIndex >= shots.length) throw new RangeError('锁定台词超过当前时长的朗读预算。请增加时长或在创作服务接入后人工分配；原话未被删改。');
      const shot = shots[shotIndex];
      const capacity = (shot.end - shot.start) * 4 - used;
      if (capacity <= 0) { shotIndex += 1; used = 0; continue; }
      const fragment = characters.slice(offset, offset + capacity).join('');
      shot.dialogue.push({ line_id: line.id, speaker: line.speaker, text: fragment });
      shot.emotion = `${line.source === 'voiceover' ? '画外声 / 旁白' : '原说话人发声'}；自然吐字，表演待导演确认；跨镜时原话连续`;
      shot.sound = '环境声不得覆盖锁定对白；逐字台词与口型需生成后另行审核';
      offset += Array.from(fragment).length;
      used += Array.from(fragment).length;
    }
  }
}

/** Accepts plain data only. No network calls, image synthesis, or semantic extraction. */
export function generateProject(input = {}) {
  const theme = text(input.theme || input.outline);
  if (!theme) throw new TypeError('请先输入主题或故事大纲。');
  const duration = Number(input.duration ?? input.total_seconds ?? 30);
  if (!Number.isInteger(duration) || duration < 30 || duration > 600 || duration % 30 !== 0)
    throw new RangeError('当前结构预览支持 30–600 秒，且必须为 30 秒的整数倍。');
  const mode = MODES[input.mode] ? input.mode : 'full';
  const ratio = text(input.ratio || input.aspect_ratio) || '9:16';
  if (!['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].includes(ratio)) throw new TypeError('请选择支持的画幅。');
  const style = text(input.style || input.visual_style);
  const references = normaliseReferences(input.references);
  const requestedOutputs = [...MODES[mode].outputs];
  const definitions = {
    characters: normaliseDefinitions(input.characters, { name: '主角', description: '虚构成年主角；具体年龄、五官关系、发型、体态及穿搭待根据大纲确认', provisional: true }),
    locations: normaliseDefinitions(input.locations, { name: '主要叙事地点', description: '地点类型、年代、室内外、门窗出口、家具位置及主光方向待根据大纲确认', provisional: true }),
    props: normaliseDefinitions(input.props, { name: '关键叙事道具', description: '推动冲突或反转的单一道具；具体形状、颜色、材质、合理比例及结构待根据大纲确认', provisional: true }),
  };
  const assets = Object.fromEntries(Object.entries(definitions).map(([kind, items]) =>
    [kind, items.map((item, i) => makeAsset(kind, item, i, references, ratio, style, requestedOutputs))]));
  const dialogueInput = input.dialogue || input.locked_dialogue || [];
  if (!Array.isArray(dialogueInput)) throw new TypeError('台词必须是按顺序排列的数组。');
  const lockedDialogue = dialogueInput.map((line, i) => {
    if (!line || typeof line.speaker !== 'string' || !line.speaker.trim() || typeof line.text !== 'string' || !line.text.trim())
      throw new TypeError('每句锁定台词需要非空 speaker 与 text；原文不会被自动改写。');
    return { id: `D${pad(i + 1, 3)}`, speaker: line.speaker, text: line.text, source: line.source || 'on-screen' };
  });
  const project = {
    schema_version: '1.0.0', engine_version: ENGINE_VERSION,
    id: `central-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
    title: text(input.title) || `${Array.from(theme.split(/[。！？\n]/)[0]).slice(0, 22).join('')}${theme.length > 22 ? '…' : ''}`,
    theme, mode, mode_label: MODES[mode].label, status: 'demo', notice: NOTICE,
    generation: { provider: null, connected: false, contentGenerated: false, imagesGenerated: false, videosGenerated: false },
    total_seconds: duration, duration, aspect_ratio: ratio, ratio,
    prefix: style || '视觉风格待确认', visual_style: style || '未锁定视觉风格，等待用户选择或提供风格参考',
    style, references, requested_outputs: requestedOutputs,
    summary: `${MODES[mode].label} · ${duration / 30} 个 30 秒生产单元 · ${ratio} · 本地结构预览`,
    story: { status: 'requires-generation', original_outline: theme,
      script: `原始主题 / 大纲：${theme}\n\n待接入创作服务后，根据原始大纲补充人物目标、阻力、失败代价、前 2–3 秒可见钩子、可验证反转与可见结局。当前仅建立可编辑结构，不代写或改动原台词。`,
      hook: '待创作服务分析：开头 2–3 秒的可见冲突或异常证据',
      conflict: '待创作服务分析：目标、阻力与失败代价',
      reversal: '待创作服务分析：反转必须有画面证据',
      ending: '待创作服务分析：本次故事的可见结果' },
    locked_dialogue: lockedDialogue, assets, scenes: [], prompts: [],
    assumptions: [
      '这是前端可编辑结构演示；没有从输入主题自动推断角色、地点或道具。未提供的资产为待替换槽位。',
      '未指定人物设定时使用虚构成年人；角色参考图为横向 16:9，与成片画幅独立。',
      '30 秒是分场生产单元；2–5 秒是分镜长度，不代表所选视频平台支持单次生成该时长。',
      '焦距、光圈、灯位和机位为摄影意图；不承诺生成模型逐项精确执行。',
      '参考图仅登记用途，尚未交给图像或视频服务；服装实款匹配和视觉审核尚未完成。',
    ],
    missing: [
      '文本创作 API、角色 / 道具图像生成 API、视频 API 均待接入。',
      '主题的实际语义分析、完整故事、选角与资产设计待生成并由导演确认。',
      ...(lockedDialogue.length ? ['台词分配仅按约 4 字 / 秒粗估，须实际朗读并检查说话人是否入画。'] : ['大纲中的台词未自动提取；需提供锁定台词数组或接入创作服务后确认。']),
      ...(mode === 'prompts' ? ['当前模式仅交付提示词草案，无需生成资产图。'] : ['所选资产图片均未生成；生成后仍需视觉审核。']),
      ...(!style ? ['视觉风格尚未确认，不应直接提交资产或视频生成任务。'] : []),
    ],
  };
  for (let i = 0; i < duration / 30; i++) {
    const id = `S${pad(i + 1)}`;
    project.scenes.push({
      id, title: `第 ${i + 1} 场 · 30 秒结构草案`, start: i * 30, end: (i + 1) * 30,
      location_ids: assets.locations.map(a => a.id), character_ids: assets.characters.map(a => a.id), prop_ids: assets.props.map(a => a.id),
      opening_state: i === 0 ? '角色身份、服装、画面方位与道具初始状态待导演确认后锁定' : `完整承接第 ${i} 场的结束状态；未经可见动作不能改变衣着、位置与道具归属`,
      ending_state: '记录本场最后一镜的人物位置、视线、服装、道具归属、开合及损坏状态；具体结果待按大纲补写',
      continuity_constraints: '身份和服装结构一致；人物自身左右手与画面左右分开记录；主轴、视线、入出画方向、门窗布局和主光方向连续；状态变化须由可见动作引起；无额外人物与未锁定台词',
      shots: makeShots(id, i, assets, project.prefix, style),
    });
  }
  scheduleDialogue(project);
  for (const scene of project.scenes) {
    scene.prompt = compileScenePrompt(project, scene);
    project.prompts.push({ id: scene.id, title: scene.title, text: scene.prompt, start: scene.start, end: scene.end });
  }
  const result = validateProject(project);
  project.checks = result;
  if (!result.valid) throw new Error(`结构校验未通过：${result.errors.join('；')}`);
  return project;
}

/** Compiles the exact same data the storyboard uses; returns one natural paragraph. */
export function compileScenePrompt(project, scene) {
  const describe = (kind, ids) => ids.map(id => project.assets[kind].find(a => a.id === id)?.description || `缺少资产 ${id}`).join('；');
  const opening = `${30} 秒连续叙事生产单元，${project.aspect_ratio}；${project.visual_style}。出镜人物：${describe('characters', scene.character_ids) || '无'}。地点：${describe('locations', scene.location_ids)}。关键道具：${describe('props', scene.prop_ids) || '无'}。开始状态：${scene.opening_state}。`;
  const shots = scene.shots.map(shot => {
    const c = shot.camera;
    const dialogue = shot.dialogue.length
      ? shot.dialogue.map(line => `${line.speaker}逐字说：“${oneLine(line.text)}”`).join('；')
      : '无对白';
    return `[${pad(shot.start)}–${pad(shot.end)}秒]${project.prefix}；${shot.scale}；${shot.movement}、${shot.angle}，全画幅等效 ${c.focal_mm}mm，f/${c.aperture}，焦点为${c.focus}，机位高 ${c.height_m}m、主体距离 ${c.distance_m}m，${c.motion_detail}；${shot.content}；${shot.action}；${shot.lighting}；${shot.emotion}，${dialogue}，${shot.sound}。`;
  }).join('');
  return oneLine(`${opening}${shots}结束状态：${scene.ending_state}。连续性约束：${scene.continuity_constraints}。`);
}

/** Structural validation only; does not certify story quality, visual accuracy, or API compatibility. */
export function validateProject(project) {
  const errors = [];
  const warnings = ['仅检查数据结构、时长和台词一致性；未进行语义、视觉、口型、实际朗读或模型参数验收。'];
  if (!project || typeof project !== 'object') return { valid: false, errors: ['缺少项目数据'], warnings, items: [] };
  const assets = project.assets || {};
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  const lines = Array.isArray(project.locked_dialogue) ? project.locked_dialogue : [];
  const seen = new Set();
  const addId = (id) => { if (!id || seen.has(id)) errors.push(`ID 缺失或重复：${id || '(空)'}`); else seen.add(id); };
  if (!Number.isInteger(project.total_seconds) || project.total_seconds < 30 || project.total_seconds % 30 || project.total_seconds !== scenes.length * 30)
    errors.push('全片时长必须等于场数 × 30 秒');
  if (!text(project.title) || !text(project.prefix) || !text(project.visual_style) || !text(project.aspect_ratio)) errors.push('片名、风格前缀、视觉方案或画幅缺失');
  const assetIds = {};
  for (const kind of ['characters', 'locations', 'props']) {
    const items = Array.isArray(assets[kind]) ? assets[kind] : [];
    assetIds[kind] = new Set(items.map(item => item.id));
    for (const asset of items) { addId(asset.id); if (!text(asset.description)) errors.push(`资产 ${asset.id} 缺少描述`); }
  }
  const lineMap = new Map();
  for (const line of lines) {
    addId(line.id); lineMap.set(line.id, line);
    if (!text(line.speaker) || !text(line.text)) errors.push(`锁定台词 ${line.id} 缺少说话人或原文`);
  }
  const fragments = [];
  for (const scene of scenes) {
    addId(scene.id);
    for (const [field, kind] of [['character_ids', 'characters'], ['location_ids', 'locations'], ['prop_ids', 'props']]) {
      const ids = Array.isArray(scene[field]) ? scene[field] : [];
      if (field === 'location_ids' && ids.length === 0) errors.push(`${scene.id} 缺少地点`);
      for (const id of ids) if (!assetIds[kind].has(id)) errors.push(`${scene.id} 引用不存在或类型错误的资产 ${id}`);
    }
    if (!text(scene.opening_state) || !text(scene.ending_state) || !text(scene.continuity_constraints)) errors.push(`${scene.id} 缺少连续性状态`);
    let previousEnd = 0;
    const shots = Array.isArray(scene.shots) ? scene.shots : [];
    if (!shots.length) errors.push(`${scene.id} 缺少镜头`);
    for (const shot of shots) {
      addId(shot.id);
      if (!Number.isInteger(shot.start) || !Number.isInteger(shot.end) || shot.start !== previousEnd || shot.end - shot.start < 2 || shot.end - shot.start > 5)
        errors.push(`${shot.id} 时间不连续或单镜不是 2–5 秒`);
      previousEnd = shot.end;
      if (!SCALES.has(shot.scale) || !MOVEMENTS.has(shot.movement) || !ANGLES.has(shot.angle)) errors.push(`${shot.id} 景别、运镜或角度不符合约定`);
      const c = shot.camera || {};
      for (const field of ['focal_mm', 'aperture', 'distance_m', 'height_m']) {
        if (typeof c[field] !== 'number' || !Number.isFinite(c[field]) || (field === 'height_m' ? c[field] < 0 : c[field] <= 0))
          errors.push(`${shot.id} 摄影参数 ${field} 无效`);
      }
      for (const value of [c.focus, c.motion_detail, shot.content, shot.action, shot.lighting, shot.emotion, shot.sound, shot.purpose])
        if (!text(value)) errors.push(`${shot.id} 缺少摄影、画面、动作、灯光、声音或推进描述`);
      if (!Array.isArray(shot.dialogue)) { errors.push(`${shot.id} 缺少台词数组`); continue; }
      for (const fragment of shot.dialogue) {
        const locked = lineMap.get(fragment.line_id);
        if (!locked || locked.speaker !== fragment.speaker || typeof fragment.text !== 'string' || !fragment.text.length)
          errors.push(`${shot.id} 台词片段引用、说话人或原文无效`);
        fragments.push(fragment);
      }
    }
    if (previousEnd !== 30) errors.push(`${scene.id} 镜头合计不是 30 秒`);
  }
  const groups = [];
  for (const fragment of fragments) {
    const last = groups.at(-1);
    if (last?.id === fragment.line_id) last.text += fragment.text;
    else groups.push({ id: fragment.line_id, text: fragment.text });
  }
  if (groups.length !== lines.length || groups.some((group, i) => group.id !== lines[i]?.id || group.text !== lines[i]?.text))
    errors.push('锁定台词的顺序、完整性或逐字原文不一致');
  return {
    valid: errors.length === 0, errors, warnings,
    items: [
      { label: '每场 30 秒 / 每镜 2–5 秒', status: errors.some(e => /秒|时间|时长/.test(e)) ? 'error' : 'pass' },
      { label: '资产 ID 与引用', status: errors.some(e => /资产|ID/.test(e)) ? 'error' : 'pass' },
      { label: lines.length ? `${lines.length} 句台词逐字与顺序` : '未提供锁定台词', status: errors.some(e => /台词/.test(e)) ? 'error' : lines.length ? 'pass' : 'pending' },
      { label: '故事与连续性人工审查', status: 'pending' },
      { label: '资产图片视觉审核', status: 'pending' },
    ],
  };
}

export function exportJSON(project) {
  return JSON.stringify(project, null, 2);
}

export function exportMarkdown(project) {
  const validation = validateProject(project);
  const output = [`# ${project.title}`, '', `> ${project.notice || NOTICE}`, '',
    `**产出模式：**${project.mode_label || project.mode}　**成片：**${project.total_seconds} 秒 / ${project.aspect_ratio}`, '',
    '## 原始主题 / 大纲', '', project.theme, '', '## 故事脚本状态', '', project.story?.script || '待创作服务生成', '',
    '## 锁定台词', ''];
  if (!project.locked_dialogue?.length) output.push('未提供锁定台词；未自动改写或提取大纲中的对白。', '');
  for (const line of project.locked_dialogue || []) output.push(`- **${line.id} · ${line.speaker}：** ${line.text}`, '');
  for (const kind of ['characters', 'locations', 'props']) {
    output.push(`## ${{ characters: '人物资产', locations: '无人场景', props: '道具资产' }[kind]}`, '');
    for (const asset of project.assets[kind]) {
      if (!asset.requested && project.mode !== 'prompts') continue;
      output.push(`### ${asset.id} · ${asset.name}`, '', asset.description, '',
        `**状态：**提示词草案 / 图片未生成。**画幅：**${asset.aspect_ratio}。**参考依据：**${asset.evidence}。`, '', asset.prompt, '',
        `**审核：**${asset.review.visual}`, '');
    }
  }
  if (project.requested_outputs?.includes('video-prompts')) {
    output.push('## 每场 30 秒分镜与视频提示词', '');
    for (const scene of project.scenes) {
      output.push(`### ${scene.id} · 全片 ${scene.start}–${scene.end} 秒`, '',
        `开始状态：${scene.opening_state}`, '',
        '| 镜号 | 当地时间 | 景别 / 运镜 / 角度 | 摄影意图 | 画面与动作 | 光线 | 原台词 / 声音 |',
        '| --- | --- | --- | --- | --- | --- | --- |');
      for (const shot of scene.shots) {
        const c = shot.camera;
        output.push(`| ${shot.id} | ${shot.start}–${shot.end}s | ${shot.scale} / ${shot.movement} / ${shot.angle} | ${escapeCell(`${c.focal_mm}mm f/${c.aperture}；高 ${c.height_m}m；距 ${c.distance_m}m；焦点 ${c.focus}；${c.motion_detail}`)} | ${escapeCell(`${shot.content}；${shot.action}`)} | ${escapeCell(shot.lighting)} | ${escapeCell(shot.dialogue.map(line => `${line.speaker}：“${line.text}”`).join('；') || '无对白')}；${escapeCell(shot.sound)} |`);
      }
      output.push('', '**本场独立大段提示词：**', '', compileScenePrompt(project, scene), '', `结束状态：${scene.ending_state}`, '');
    }
  }
  output.push('## 参考记录', '');
  if (!project.references?.length) output.push('无已登记参考；未完成实款服装匹配。', '');
  for (const reference of project.references || []) output.push(`- ${reference.id} · ${reference.name} / ${reference.type}：${reference.evidence}${reference.url ? `（${reference.url}）` : ''}`, '');
  output.push('## 补充假设与待完成项', '', ...[...(project.assumptions || []), ...(project.missing || [])].map(item => `- ${item}`), '',
    '## 检查结果', '', `结构检查：${validation.valid ? '通过' : '未通过'}；${validation.warnings.join('')}`, '', ...validation.errors.map(item => `- ${item}`), '',
    '## 视频模型适配', '', '30 秒为主生产单元。选定平台后根据官方当前时长、画幅、参考素材和声音能力拆分可执行批次；不改变母场的锁定台词与连续性。当前没有提交视频任务。', '');
  return output.join('\n');
}
