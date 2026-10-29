import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeHandler, CreativeGenerationError } from '../server/creative.js';
import { validateProject, compileScenePrompt } from '../src/engine.js';

const INPUT = {
  theme: '修表师在旧怀表里发现父亲留下的车票，在最后一班车前赶到车站与妹妹团聚。',
  style: '克制日常写实，自然光', mode: 'full', duration: 60, ratio: '9:16',
  characters: [{ name: '林夏', description: '32 岁虚构成年修表师，短发，棕色工装外套' }],
  props: [{ name: '旧怀表', description: '黄铜外壳，黑色表盘' }],
  locations: [{ name: '钟表店', description: '临街窗户在左，木柜台在右' }],
  dialogue: [{ speaker: '林夏', text: '等一下……我回来了。🙂', source: 'on-screen' }],
  references: [{ name: 'portrait.png', kind: 'portrait', size: 1000 }],
};
const copy = value => JSON.parse(JSON.stringify(value));
function completedTemplate(request) {
  const { user_input: input, project_template: project } = JSON.parse(request.input);
  for (const kind of ['characters', 'locations', 'props']) {
    for (const asset of project.assets[kind]) {
      asset.description = (input[kind].find(d => d.name === asset.name)?.description || '虚构成年人或原创实物造型') + '；具体设计采用清楚、可信的结构与比例。';
      asset.prompt = `${asset.name}：${asset.description}；干净中性背景、单一主体、无文字标尺，造型完整。`;
    }
  }
  project.story = {
    original_outline: input.theme, status: 'generated',
    script: `钟表店，傍晚。林夏拨开怀表背盖，一张旧车票掉在柜台上。她对着停在午夜的挂钟读完背面地址，冲向车站。妹妹站在检票口等她，伸手接过父亲的表。${project.locked_dialogue.map(d => `${d.speaker}：“${d.text}”`).join('')}`,
    hook: '车票从怀表的背盖内掉出，落在修表工具旁。',
    conflict: '林夏看见挂钟与末班车时间相差三分钟，拿起外套向门口跑去。',
    reversal: '车票背面写的是妹妹的新地址，妹妹在车站伸出一只空着的手。',
    ending: '林夏把怀表放到妹妹手里，两人走出检票口。',
  };
  for (const scene of project.scenes) {
    scene.title = '寻回家人的最后一班车';
    scene.opening_state = '林夏站在柜台右侧，右手扶着闭合怀表，窗光从左侧照入。';
    scene.ending_state = '林夏与妹妹在站台右侧相会，怀表已交到妹妹左手。';
    for (const [index, shot] of scene.shots.entries()) {
      shot.action = ['林夏转动怀表背盖，一张车票滑到木柜台上。', '她抬眼比较挂钟与车票上的时间，拎起外套。', '她沿柜台右侧冲向门口，握紧怀表。', '车票背面的新地址随她的手掌展开而露出。', '她沿站台右侧奔向检票口，在黄线前停住。', '妹妹从检票口右侧走来，向她伸出左手。', '她把怀表放入妹妹手中，两人并肩走出画面。'][index];
      shot.content = '钟表店和车站的固定主轴保持清楚，人物与关键物件完整可辨。';
      shot.lighting = '低饱和晚光从画面左侧照入，阴影落向右侧。';
      shot.emotion = '林夏收紧下颌后松开，声量由急促变为平稳。';
      shot.sound = '挂钟滴答声与站台脚步声，不覆盖原始台词。';
      shot.purpose = '使车票证据与家人的行动发生清楚因果变化。';
    }
  }
  return project;
}
function fixture(change, { text, result, outputWrapper = false } = {}) {
  const requests = [];
  const service = { respond: async request => {
    requests.push(request);
    let project = completedTemplate(request);
    if (change) change(project, JSON.parse(request.input));
    return result ?? { text: text ?? JSON.stringify(outputWrapper ? { project } : project), model: 'available-text-model', usingChatGPTPlan: true };
  } };
  return { requests, call: (input = INPUT) => createCreativeHandler()({ input: copy(input), model: 'available-text-model' }, { chatgptService: service }) };
}
const code = value => error => error instanceof CreativeGenerationError && error.code === value;

test('uses exactly one real text response, preserves inputs and dialogue, recompiles all prompts from returned assets', async () => {
  const f = fixture();
  const { project } = await f.call();
  assert.equal(f.requests.length, 1);
  assert.equal(project.status, 'generated'); assert.equal(project.generation.contentGenerated, true);
  assert.equal(project.generation.imagesGenerated, false); assert.equal(project.generation.videosGenerated, false);
  assert.equal(project.theme, INPUT.theme); assert.equal(project.duration, INPUT.duration);
  assert.equal(project.mode, INPUT.mode); assert.equal(project.aspect_ratio, INPUT.ratio);
  assert.deepEqual(project.locked_dialogue.map(({ speaker, text, source }) => ({ speaker, text, source })), INPUT.dialogue);
  assert.equal(validateProject(project).valid, true);
  for (const scene of project.scenes) assert.equal(scene.prompt, compileScenePrompt(project, scene));
  for (const asset of Object.values(project.assets).flat()) {
    assert.equal(asset.image, null); assert.equal(asset.image_url, null);
    assert.match(asset.evidence, /参考像素未提供/); assert.match(asset.review.visual, /未做视觉审核/);
  }
  assert.match(project.missing.join(''), /视频未生成/);
});

test('allows the theme to add separate cast and prop assets without renumbering existing definitions', async () => {
  const f = fixture(project => {
    project.assets.characters.push({ ...copy(project.assets.characters[0]), id: 'C002', name: '妹妹', description: '26 岁虚构成年女性，齐肩卷发，浅灰针织衫。', prompt: '妹妹，独立单身份四视角，清楚自然的五官和浅灰针织衫。' });
    project.assets.props.push({ ...copy(project.assets.props[0]), id: 'P002', name: '旧车票', description: '米黄色纸车票，边角轻微折痕。', prompt: '米黄色纸车票，干净中性背景，无人无手，完整静置。' });
    project.scenes[1].character_ids.push('C002'); project.scenes[1].prop_ids.push('P002');
  });
  const { project } = await f.call();
  assert.equal(project.assets.characters.length, 2);
  assert.ok(project.scenes[1].prompt.includes('齐肩卷发'));
  assert.equal(validateProject(project).valid, true);
});

test('rejects edits to original lines, speakers, ordering or user asset definitions', async () => {
  for (const edit of [
    p => { p.locked_dialogue[0].text = '我回来了。'; },
    p => { p.locked_dialogue[0].speaker = '妹妹'; },
    p => { p.locked_dialogue.push({ id: 'D002', speaker: '妹妹', text: '新句子', source: 'on-screen' }); },
  ]) await assert.rejects(fixture(edit).call(), code('locked_dialogue_changed'));
  await assert.rejects(fixture(p => { p.assets.characters[0].description = '已经删除用户原始年龄与穿搭'; }).call(), code('asset_definition_changed'));
});

test('rejects altered timing, missing assets and invalid references rather than padding or silently repairing', async () => {
  await assert.rejects(fixture(p => { p.scenes[0].shots[0].end = 4; }).call(), code('invalid_model_output'));
  await assert.rejects(fixture(p => { p.scenes[0].character_ids = ['C099']; }).call(), code('invalid_project_structure'));
  await assert.rejects(fixture(p => { p.assets.props = []; }).call(), code('invalid_model_output'));
});

test('rejects malformed JSON and completed-looking media inventions', async () => {
  for (const text of ['not json', '[]', 'null']) await assert.rejects(fixture(null, { text }).call(), code('invalid_model_output'));
  await assert.rejects(fixture(p => { p.assets.characters[0].image_url = 'https://fake.example/image.png'; }).call(), code('model_media_not_allowed'));
  await assert.rejects(fixture(p => { p.scenes[0].thumbnail = 'https://fake.example/thumb.png'; }).call(), code('model_media_not_allowed'));
  await assert.rejects(fixture(p => { p.generation.imagesGenerated = true; }).call(), code('model_media_not_allowed'));
});

test('rejects changes to original theme, style, mode, duration, ratio and reference evidence', async () => {
  for (const [key, value] of [['theme', '另一个主题'], ['style', '强行换风格'], ['mode', 'props'], ['duration', 90], ['ratio', '16:9'], ['aspect_ratio', '16:9']])
    await assert.rejects(fixture(p => { p[key] = value; }).call(), code('original_input_changed'));
  await assert.rejects(fixture(p => { p.references[0].evidence = '模型已看过人像并通过审核'; }).call(), code('reference_evidence_changed'));
});

test('does not call the model for invalid input or accidentally upload reference pixels', async () => {
  for (const modify of [
    p => { p.theme = ''; }, p => { p.style = ''; }, p => { p.mode = 'unknown'; }, p => { p.duration = 45; },
    p => { p.references[0].dataUrl = 'data:image/png;base64,PRIVATEPIXELS'; },
    p => { p.references[0].path = '/private/photo.png'; },
  ]) {
    const input = copy(INPUT); modify(input); const f = fixture();
    await assert.rejects(f.call(input), error => error instanceof CreativeGenerationError && error.status === 400);
    assert.equal(f.requests.length, 0);
  }
});

test('rejects remaining demo placeholders and never marks asset-only mode as a finished story', async () => {
  await assert.rejects(fixture(p => { p.story.script = '待创作服务完成结构草案'; }).call(), code('incomplete_model_output'));
  const { project } = await fixture().call({ ...INPUT, mode: 'characters' });
  assert.equal(project.story.status, 'not_requested'); assert.equal(project.prompts.length, 0);
  assert.ok(project.scenes.every(s => s.status === 'not_requested' && s.prompt === ''));
  assert.equal(project.assets.characters[0].requested, true); assert.equal(project.assets.props[0].requested, false);
  assert.equal(project.generation.contentGenerated, true); assert.equal(project.generation.imagesGenerated, false);
});

test('objects may reorder JSON keys but may not alter reference or dialogue values', async () => {
  const { project } = await fixture(p => {
    p.locked_dialogue = p.locked_dialogue.map(d => ({ source: d.source, text: d.text, speaker: d.speaker, id: d.id }));
    p.references = p.references.map(r => Object.fromEntries(Object.entries(r).reverse()));
  }).call();
  assert.equal(project.checks.valid, true);
});
