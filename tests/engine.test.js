import test from 'node:test';
import assert from 'node:assert/strict';
import { generateProject, validateProject, compileScenePrompt, exportJSON, exportMarkdown } from '../src/engine.js';

const brief = { theme: '两个朋友在最后一班车前，把一封迟到十年的信送回原处。', style: '温柔、克制的日常写实；自然光；低饱和暖色', duration: 60, ratio: '9:16', mode: 'full' };
const copy = (data) => JSON.parse(JSON.stringify(data));

test('produces continuous 30-second units and 2–5 second shots without claiming synthesis', () => {
  const project = generateProject({ ...brief, duration: 90 });
  assert.equal(project.status, 'demo');
  assert.equal(project.generation.connected, false);
  assert.equal(project.generation.contentGenerated, false);
  assert.equal(project.generation.imagesGenerated, false);
  assert.equal(project.theme, brief.theme);
  assert.equal(project.scenes.length, 3);
  assert.equal(project.scenes.at(-1).end, 90);
  for (const scene of project.scenes) {
    let end = 0;
    for (const shot of scene.shots) {
      assert.equal(shot.start, end);
      assert.ok(shot.end - shot.start >= 2 && shot.end - shot.start <= 5);
      end = shot.end;
    }
    assert.equal(end, 30);
    assert.doesNotMatch(scene.prompt, /[\r\n]/);
    assert.match(scene.prompt, /虚构成年主角/);
    assert.match(scene.prompt, /无对白/);
    assert.equal(scene.prompt, compileScenePrompt(project, scene));
  }
  assert.equal(validateProject(project).valid, true);
  assert.equal(project.assets.characters[0].image, null);
  assert.equal(project.assets.characters[0].aspect_ratio, '16:9');
});

test('rejects missing themes and invalid durations instead of padding or truncating', () => {
  assert.throws(() => generateProject({ ...brief, theme: '  ' }), /主题/);
  for (const duration of [0, 20, 45, 61, 601, -30, Number.NaN])
    assert.throws(() => generateProject({ ...brief, duration }), /30/);
  assert.throws(() => generateProject({ ...brief, ratio: 'potato' }), /画幅/);
});

test('only flags assets that the requested mode actually asks for', () => {
  const characters = generateProject({ ...brief, mode: 'characters' });
  assert.deepEqual(characters.requested_outputs, ['characters']);
  assert.equal(characters.assets.characters[0].requested, true);
  assert.equal(characters.assets.props[0].requested, false);
  assert.doesNotMatch(exportMarkdown(characters), /### P001/);
  const props = generateProject({ ...brief, mode: 'props' });
  assert.deepEqual(props.requested_outputs, ['props']);
  const prompts = generateProject({ ...brief, mode: 'prompts' });
  assert.equal(prompts.generation.imagesGenerated, false);
  assert.ok(prompts.missing.some(item => item.includes('仅交付提示词')));
});

test('retains exact dialogue, punctuation, speaker, Unicode and order across shot boundaries', () => {
  const dialogue = [
    { speaker: '阿和', text: '等一下……这封信，我一直没有拆开。🙂' },
    { speaker: '小周', text: '“你回来了？”\n嗯，我回来了。' },
  ];
  const project = generateProject({ ...brief, dialogue });
  assert.equal(validateProject(project).valid, true);
  for (let i = 0; i < dialogue.length; i++) {
    const line = project.locked_dialogue[i];
    const fragments = project.scenes.flatMap(scene => scene.shots).flatMap(shot => shot.dialogue).filter(fragment => fragment.line_id === line.id);
    assert.equal(fragments.map(fragment => fragment.text).join(''), dialogue[i].text);
    assert.ok(fragments.every(fragment => fragment.speaker === dialogue[i].speaker));
    assert.equal(JSON.parse(exportJSON(project)).locked_dialogue[i].text, dialogue[i].text);
  }
  assert.throws(() => generateProject({ ...brief, duration: 30, dialogue: [{ speaker: '阿和', text: '信'.repeat(121) }] }), /朗读预算/);
});

test('keeps reference provenance without passing off uploaded pixels as inspected assets', () => {
  const project = generateProject({ ...brief, references: {
    portraits: [{ name: 'character.png', dataUrl: 'data:image/png;base64,PRIVATEPIXELS' }],
    style: [{ name: 'mood.jpg', url: 'https://example.com/mood.jpg' }],
  } });
  assert.equal(project.references.length, 2);
  assert.match(project.references[0].evidence, /未做视觉审核/);
  assert.doesNotMatch(exportJSON(project), /PRIVATEPIXELS/);
  assert.equal(project.references[1].url, 'https://example.com/mood.jpg');
  assert.match(project.assets.characters[0].prompt, /未完成.*实款视觉匹配/);
});

test('validator catches bad timing, camera values, asset types, duplicate IDs and altered dialogue', () => {
  const original = generateProject({ ...brief, dialogue: [{ speaker: '甲', text: '我到了。' }, { speaker: '乙', text: '请进。' }] });
  const changes = [
    project => { project.scenes[0].shots[1].start = 1; },
    project => { project.scenes[0].shots[0].end = 6; },
    project => { project.scenes[0].shots[0].camera.focal_mm = true; },
    project => { project.scenes[0].character_ids = ['P001']; },
    project => { project.assets.props[0].id = 'C001'; },
    project => { project.scenes[0].shots[0].movement = '俯拍'; },
    project => { project.scenes[0].shots[0].dialogue[0].text = '我来到了。'; },
    project => { project.scenes[0].shots[0].dialogue[0].speaker = '乙'; },
  ];
  for (const change of changes) {
    const broken = copy(original);
    change(broken);
    assert.equal(validateProject(broken).valid, false);
  }
});

test('exports complete requested assets, every scene, provenance and pending work', () => {
  const project = generateProject({ ...brief,
    characters: [{ name: '阿和', description: '虚构成年女性，短直发，灰绿色翻领外套；服装参考待核验' }],
    props: [{ name: '旧信封', description: '浅米色长方形纸信封，无字封面；背面封口结构待确认' }],
    locations: [{ name: '车站门口', description: '候车室前门位于画面左侧，固定长椅位于右侧，窗光从左侧进入' }],
  });
  const markdown = exportMarkdown(project);
  for (const scene of project.scenes) assert.ok(markdown.includes(compileScenePrompt(project, scene)));
  assert.match(markdown, /### C001/);
  assert.match(markdown, /### L001/);
  assert.match(markdown, /### P001/);
  assert.match(markdown, /图片未生成/);
  assert.match(markdown, /并不是|不是 AI 创作结果/);
  assert.ok(project.scenes.every(scene => scene.prompt.includes('灰绿色翻领外套') && scene.prompt.includes('无字封面')));
});

test('missing style stays explicitly unconfirmed rather than inventing a genre', () => {
  const project = generateProject({ ...brief, style: '' });
  assert.equal(project.prefix, '视觉风格待确认');
  assert.ok(project.missing.some(item => item.includes('视觉风格尚未确认')));
  assert.equal(project.story.status, 'requires-generation');
});
