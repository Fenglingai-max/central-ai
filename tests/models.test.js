import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, getModel, buildVideoDraft, splitSceneForModel } from '../src/models.js';

const draft = { prompt: '固定中景，角色放下信封。', duration: 5, ratio: '16:9', resolution: '720p' };
const makeScene = lengths => {
  let cursor = 0;
  return { id: 'S01', opening_state: '角色站在桌旁，信封未拆', continuity_constraints: '原对白逐字保留',
    shots: lengths.map((length, index) => {
      const shot = { id: `S01-${index + 1}`, start: cursor, end: cursor + length,
        content: `镜头 ${index + 1}`, action: '放下信封', dialogue: [{ speaker: '主角', text: `原话${index + 1}。` }] };
      cursor += length;
      return shot;
    }) };
};

test('defaults to Seedance 2.5 and explicitly records that no task was submitted', () => {
  const value = buildVideoDraft(draft);
  assert.equal(MODELS[0].id, 'seedance-2.5');
  assert.equal(getModel().id, 'seedance-2.5');
  assert.equal(value.status, 'not_submitted');
  assert.equal(value.submitted, false);
  assert.equal(value.contract, 'central.ai/video-draft');
  assert.equal(value.payload.referenceUploadStatus, 'not_required');
});

test('rejects retired, unknown, and incompatible requests', () => {
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'sora-2' }), /停服/);
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'unverified' }), /未知/);
  assert.throws(() => buildVideoDraft({ ...draft, duration: 3 }), /不支持/);
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'wan-2.7', taskType: 'image' }), /输入类型/);
  assert.throws(() => buildVideoDraft({ ...draft, taskType: 'image' }), /至少/);
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'runway-gen4.5', ratio: '9:16' }), /画幅/);
});

test('references retain file metadata without pixels, URLs, or false upload IDs', () => {
  const reference = { name: 'face.png', type: 'image/png', size: 1200, lastModified: 123,
    dataUrl: 'data:image/png;base64,SECRET', url: 'https://example.com/secret.png', uploadId: 'fake' };
  const value = buildVideoDraft({ ...draft, taskType: 'image', references: [reference] });
  const metadata = value.payload.references[0];
  assert.equal(metadata.name, 'face.png');
  assert.equal(metadata.mimeType, 'image/png');
  assert.equal(metadata.uploadStatus, 'pending');
  assert.equal(value.payload.referenceUploadStatus, 'pending');
  for (const key of ['dataUrl', 'url', 'uploadId']) assert.equal(key in metadata, false);
  assert.throws(() => buildVideoDraft({ ...draft, taskType: 'image', references: [{ name: 'clip.mp4', type: 'video/mp4' }] }), /必须是图片/);
});

test('Veo reference and high-resolution conditions are checked together', () => {
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'veo-3.1', duration: 6, resolution: '1080p' }), /8 秒/);
  const reference = { name: 'face.jpg', type: 'image/jpeg' };
  assert.throws(() => buildVideoDraft({ ...draft, modelId: 'veo-3.1', duration: 4, taskType: 'image', references: [reference] }), /8 秒/);
  assert.equal(buildVideoDraft({ ...draft, modelId: 'veo-3.1', duration: 8, taskType: 'image', references: [reference] }).submitted, false);
});

test('partitions complete scenes at shot boundaries and retains every original line', () => {
  const scene = makeScene([3, 4, 4, 4, 5, 5, 5]);
  const original = JSON.stringify(scene);
  const value = splitSceneForModel(scene, 'seedance-2.0');
  assert.equal(value.supported, true);
  assert.equal(value.originalDuration, 30);
  assert.equal(value.segments.reduce((sum, part) => sum + part.duration, 0), 30);
  assert.deepEqual(value.segments.flatMap(part => part.shots).map(shot => shot.id), scene.shots.map(shot => shot.id));
  assert.deepEqual(value.segments.flatMap(part => part.shots).flatMap(shot => shot.dialogue), scene.shots.flatMap(shot => shot.dialogue));
  assert.ok(value.segments.every(part => getModel('seedance-2.0').durations.includes(part.duration)));
  assert.equal(JSON.stringify(scene), original);
});

test('finds a valid partition instead of leaving a short greedy tail', () => {
  const value = splitSceneForModel(makeScene([5, 4, 2]), 'seedance-2.0');
  assert.equal(value.supported, true);
  assert.deepEqual(value.segments.map(part => part.duration), [11]);
  const split = splitSceneForModel(makeScene([3, 3, 3, 3]), 'veo-3.1');
  assert.equal(split.supported, true);
  assert.deepEqual(split.segments.map(part => part.duration), [6, 6]);
});

test('unsupported discrete lengths and short scenes are never padded or truncated', () => {
  const value = splitSceneForModel(makeScene([3, 4, 4, 4, 5, 5, 5]), 'veo-3.1');
  assert.equal(value.supported, false);
  assert.deepEqual(value.segments, []);
  assert.match(value.errors[0], /未补拍、未裁剪/);
  const short = splitSceneForModel(makeScene([3]), 'seedance-2.5');
  assert.equal(short.supported, false);
  assert.ok(short.errors.some(message => message.includes('短于模型最短')));
  assert.equal(short.originalDuration, 3);
});

test('rejects gaps and overlaps without silently rewriting the storyboard', () => {
  const scene = makeScene([4, 4]);
  scene.shots[1].start = 5;
  const value = splitSceneForModel(scene);
  assert.equal(value.supported, false);
  assert.match(value.errors[0], /连续/);
});
