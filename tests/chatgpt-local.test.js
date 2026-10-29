import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { codexEnvironment, createChatGPTLocalService, createCodexRPC, parseCodexExecOutput, runImageTurn, ChatGPTLocalError } from '../server/chatgpt-local.js';

const account = email => ({ account: { type: 'chatgpt', email, planType: 'plus' } });
function fakeRPC({ accounts = [account('first@example.test')], imageItems = [], turnStatus = 'completed' } = {}) {
  let accountIndex = 0;
  const listeners = new Set(), requests = [];
  return {
    requests,
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'account/read') return accounts[Math.min(accountIndex++, accounts.length - 1)];
      if (method === 'model/list') return { data: [{ model: 'available-model', displayName: 'Available model', isDefault: true }], nextCursor: null };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') { for (const item of imageItems) for (const fn of listeners) fn({ method: 'item/completed', params: { threadId: 'thread-1', item } }); return { turn: { id: 'turn-1' } }; }
      throw Error('unexpected RPC');
    },
    onNotification(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    waitFor() { return Promise.resolve({ threadId: 'thread-1', turn: { id: 'turn-1', status: turnStatus } }); },
    close() {},
  };
}
const successfulExec = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"story":"ready"}' } }) + '\n' + JSON.stringify({ type: 'turn.completed', usage: {} });

test('environment removes API credentials so personal mode cannot silently charge a Platform key', () => {
  const env = codexEnvironment({ HOME: '/test-home', PATH: '/bin', UNKNOWN_SERVICE_SECRET: 'test-never-pass', OPENAI_API_KEY: 'test-key', CODEX_API_KEY: 'test-key', CODEX_ACCESS_TOKEN: 'test-token', OPENAI_BASE_URL: 'https://untrusted.test' });
  assert.deepEqual(env, { HOME: '/test-home', PATH: '/bin' });
});

test('status exposes safe current-account metadata and starts no generation turn', async () => {
  const rpc = fakeRPC();
  const service = await createChatGPTLocalService({ cliPath: '/fake/codex', commandRunner: async (cli, args) => ({ code: 0, output: args[0] === 'features' ? 'image_generation stable true' : 'Logged in using ChatGPT', errorOutput: '' }), rpcFactory: async () => rpc });
  const status = await service.status();
  assert.equal(status.provider, 'codex'); assert.equal(status.session.sharing, true); assert.equal(status.capabilities.images, true);
  assert.deepEqual(rpc.requests.map(r => r.method), ['account/read']);
  assert.equal(JSON.stringify(status).includes('accessToken'), false);
  assert.equal(status.profiles.length, 1); service.close();
});

test('API-key sign-in is rejected before opening the app-server', async () => {
  let calls = 0;
  const service = await createChatGPTLocalService({ cliPath: '/fake/codex', commandRunner: async () => ({ code: 0, output: 'Logged in using an API key', errorOutput: '' }), rpcFactory: async () => { calls++; return fakeRPC(); } });
  const status = await service.status(); assert.equal(status.session.sharing, false); assert.equal(status.session.error.code, 'api_key_not_allowed'); assert.equal(calls, 0);
});

test('text generation requires real completed JSONL and checks the account did not switch', async t => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'central-codex-test-')); t.after(() => rm(workDir, { recursive: true, force: true }));
  let calls = [];
  const service = await createChatGPTLocalService({ cliPath: '/fake/codex', workDir, rpcFactory: async () => fakeRPC(), commandRunner: async (cli, args, options) => { calls.push({ cli, args, options }); return { code: 0, output: successfulExec, errorOutput: '' }; } });
  const output = await service.respond({ model: 'available-model', input: 'A private story idea', instructions: 'Return JSON.' });
  assert.equal(output.text, '{"story":"ready"}'); assert.equal(output.usingChatGPTPlan, true);
  for (const flag of ['shell_tool','apps','plugins','browser_use','computer_use']) assert.ok(calls[0].args.includes(flag)); assert.ok(calls[0].args.includes('--ephemeral')); assert.ok(calls[0].args.includes('read-only')); assert.equal(calls[0].args.includes('A private story idea'), false); assert.match(calls[0].options.prompt, /A private story idea/);
  let index = 0;
  const changed = await createChatGPTLocalService({ cliPath: '/fake/codex', workDir, rpcFactory: async () => fakeRPC({ accounts: [account(index++ === 0 ? 'first@example.test' : 'second@example.test')] }), commandRunner: async () => ({ code: 0, output: successfulExec }) });
  await assert.rejects(changed.respond({ model: 'available-model', input: 'A story' }), { code: 'connection_changed' });
});

test('failed, malformed or incomplete agent output is never success', () => {
  for (const [out, code] of [[successfulExec, 1], ['{"type":"turn.completed"}', 0], ['not json', 0], [successfulExec + '\n{"type":"turn.failed","error":{"message":"raw secret diagnostic"}}', 0]]) {
    assert.throws(() => parseCodexExecOutput(out, code), error => error.name === 'ChatGPTLocalError' && !error.message.includes('raw secret'));
  }
});

test('RPC uses stdio and declines approval requests without shell execution', async () => {
  const sent = [], spawned = [];
  function spawnMock(binary, args, options) {
    spawned.push({ binary, args, options });
    const child = new EventEmitter(); child.exitCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    child.stdin.on('data', chunk => { for (const line of chunk.toString().trim().split('\n')) { const msg = JSON.parse(line); sent.push(msg); if (msg.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\n')); } });
    return child;
  }
  const rpc = await createCodexRPC({ cliPath: '/fake/codex', spawnImpl: spawnMock });
  rpc.child.stdout.write(JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 100, params: {} }) + '\n');
  assert.deepEqual(sent.find(m => m.id === 100).result, { decision: 'decline' });
  assert.equal(spawned[0].options.shell, false); assert.ok(spawned[0].args.includes('--stdio')); for (const flag of ['shell_tool','apps','plugins','browser_use','computer_use']) assert.ok(spawned[0].args.includes(flag)); assert.equal(sent.some(m => m.method === 'turn/start'), false); rpc.close();
});

test('native image completion must attest a regular PNG; copy only that actual file', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'central-codex-image-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'native.png'), job = path.join(temp, 'job');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  await writeFile(source, png);
  const rpc = fakeRPC({ imageItems: [{ type: 'imageGeneration', id: 'image-1', status: 'completed', savedPath: source, result: 'native result' }] });
  const result = await runImageTurn({ cliPath: '/fake/codex', cwd: job, prompt: 'Use the native image tool', rpcFactory: async () => rpc });
  assert.equal(result.imageGenerated, true); assert.deepEqual(await readFile(path.join(job, 'asset.png')), png);
  assert.equal(rpc.requests.find(r => r.method === 'thread/start').params.approvalPolicy, 'never');
  assert.deepEqual(rpc.requests.find(r => r.method === 'turn/start').params.sandboxPolicy.writableRoots, [await (await import('node:fs/promises')).realpath(job)]);
});

test('turn completion alone, failed image tools and fileId-only artifacts are rejected', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'central-codex-no-image-')); t.after(() => rm(temp, { recursive: true, force: true }));
  for (const [imageItems, code] of [[[], 'image_generation_failed'], [[{ type: 'imageGeneration', status: 'completed', failure: { type: 'usageLimitExceeded' }, savedPath: '/not-used' }], 'image_generation_failed'], [[{ type: 'imageGeneration', id: 'id', status: 'completed', fileId: 'not-a-local-file' }], 'image_file_unavailable']]) {
    await assert.rejects(runImageTurn({ cwd: temp, prompt: 'Native generation', rpcFactory: async () => fakeRPC({ imageItems }) }), { code });
  }
});
