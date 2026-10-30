import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AsrAdmin } from '../asr-admin.js';

test('ASR admin starts and stops with automatic speakers and optional model path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-minutes-asr-admin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let online = false;
  const health = createServer((request, response) => {
    if (online) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', backend: 'whispercpp' }));
    } else {
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve) => health.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => health.close(resolve)));
  const launcher = join(directory, 'launcher.mjs');
  const argsLog = join(directory, 'args.jsonl');
  await writeFile(launcher, `import { appendFile } from 'node:fs/promises';\nawait appendFile(process.argv[2], JSON.stringify(process.argv.slice(3)) + '\\n');\nif (process.argv[3] === 'start') process.env.ONLINE = '1'; else process.env.ONLINE = '0';\n`, 'utf8');
  const config = {
    asrBaseUrl: `http://127.0.0.1:${health.address().port}`,
    asrPython: process.execPath,
    asrLauncher: launcher,
    whisperCppModel: join(directory, 'model.bin'),
  };
  const admin = new AsrAdmin({ config });
  admin.run = async (command, args) => {
    await appendFile(argsLog, JSON.stringify([command, ...args]) + '\n');
    online = args.includes('start');
  };
  const started = await admin.start();
  assert.equal(started.online, true);
  const stopped = await admin.stop();
  assert.equal(stopped.online, false);
  const args = (await readFile(argsLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))[0];
  assert.ok(args.includes('--speakers'));
  assert.equal(args[args.indexOf('--speakers') + 1], '0');
  assert.ok(args.includes('--cpp-model'));
});

test('ASR model download completes atomically and appears in model list', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-minutes-model-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('ggml-test-model');
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = { asrModelDir: join(directory, 'models') };
  const admin = new AsrAdmin({ config });
  const result = await admin.downloadModel({ url: `http://127.0.0.1:${server.address().port}/model.bin` });
  assert.equal(result.downloaded, true);
  assert.equal(await readFile(result.path, 'utf8'), 'ggml-test-model');
  const models = await admin.models();
  assert.equal(models[0].size, bytes.length);
  assert.equal(models[0].name, 'ggml-large-v3.bin');
});
