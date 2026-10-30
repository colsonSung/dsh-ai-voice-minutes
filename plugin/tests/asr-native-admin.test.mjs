import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ASR_MODEL_CATALOG, AsrAdmin } from '../asr-admin.js';

async function fixture(t, prefix = 'asr-native-admin-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'models');
}

async function touch(path, contents = 'x') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function completeEntry(entry, modelDir) {
  if (entry.id === 'sensevoice') {
    for (const name of ['model.int8.onnx', 'model.onnx', 'tokens.txt']) {
      await touch(join(modelDir, 'sensevoice', name), name);
    }
  } else if (entry.id === 'fun-asr-nano') {
    for (const file of entry.files) await touch(join(modelDir, 'fun-asr-nano', file.name), file.name);
  }
}

test('startArguments builds exact backend-specific native service arguments', () => {
  const modelDir = join(tmpdir(), 'asr-arguments-models');
  const config = {
    asrModelDir: modelDir,
    asrLauncher: '/plugin/native/asr/local_services.py',
    asrDiarizeThreshold: 0.77,
    whisperCppModel: join(modelDir, 'custom.bin'),
    funAsrPython: join(modelDir, 'runtime', 'venv-funasr', 'bin', 'python'),
  };
  const admin = new AsrAdmin({ config });
  const common = ['--diarize', '--speakers', '0', '--prompt', '', '--threshold', '0.77'];
  // pass 2 精修参数对所有后端都传递，保证 /finalize 随时可用
  const pass2 = ['--fun-asr-dir', join(modelDir, 'fun-asr-nano'), '--fun-asr-python', config.funAsrPython];

  const whisper = admin.startArguments();
  assert.deepEqual(whisper.slice(0, 6), [config.asrLauncher, 'start', 'asr', '--backend', 'whispercpp', '--cpp-model']);
  assert.equal(whisper[6], config.whisperCppModel);
  assert.deepEqual(whisper.slice(7, 11), pass2);
  assert.deepEqual(whisper.slice(11), common);

  config.asrBackend = 'sensevoice';
  const sense = admin.startArguments();
  assert.deepEqual(sense.slice(0, 7), [
    config.asrLauncher, 'start', 'asr', '--backend', 'sensevoice',
    '--sense-voice-dir', join(modelDir, 'sensevoice'),
  ]);
  assert.deepEqual(sense.slice(7, 11), pass2);
  assert.deepEqual(sense.slice(11), common);

  config.asrBackend = 'funasr';
  const fun = admin.startArguments();
  assert.deepEqual(fun.slice(0, 5), [
    config.asrLauncher, 'start', 'asr', '--backend', 'funasr',
  ]);
  assert.deepEqual(fun.slice(5, 9), pass2);
  assert.deepEqual(fun.slice(9), common);
});

test('catalog reports SenseVoice and Fun-ASR-Nano download/active state by backend', async (t) => {
  const modelDir = await fixture(t);
  const senseDefinition = ASR_MODEL_CATALOG.find((entry) => entry.id === 'sensevoice');
  const funDefinition = ASR_MODEL_CATALOG.find((entry) => entry.id === 'fun-asr-nano');
  assert.ok(senseDefinition, 'SenseVoice catalog entry exists');
  assert.ok(funDefinition, 'Fun-ASR-Nano catalog entry exists');
  assert.ok(funDefinition.files.length >= 10, 'Fun-ASR-Nano includes model and tokenizer files');
  assert.ok(senseDefinition.sizeBytes > 1_000_000_000);
  assert.ok(funDefinition.sizeBytes > 1_800_000_000);
  await completeEntry(senseDefinition, modelDir);
  await completeEntry(funDefinition, modelDir);

  const admin = new AsrAdmin({ config: { asrModelDir: modelDir, asrBackend: 'sensevoice' } });
  let catalog = await admin.catalog();
  assert.equal(catalog.entries.length, 11);
  assert.equal(catalog.entries.find((entry) => entry.id === 'sensevoice').downloaded, true);
  assert.equal(catalog.entries.find((entry) => entry.id === 'sensevoice').active, true);
  assert.equal(catalog.entries.find((entry) => entry.id === 'fun-asr-nano').downloaded, true);
  assert.equal(catalog.entries.find((entry) => entry.id === 'fun-asr-nano').active, false);

  admin.config.asrBackend = 'funasr';
  catalog = await admin.catalog();
  assert.equal(catalog.entries.find((entry) => entry.id === 'fun-asr-nano').active, true);
  admin.probe = async () => ({ online: false, health: { status: 'offline' } });
  const status = await admin.status();
  assert.equal(status.backend, 'funasr');
  assert.equal(status.modelPaths.whispercpp, join(modelDir, 'ggml-large-v3.bin'));
  assert.equal(status.modelPaths.sensevoice, join(modelDir, 'sensevoice'));
  assert.equal(status.modelPaths.funasr, join(modelDir, 'fun-asr-nano'));
});

test('single and multi-file downloads resume partial files with HTTP Range inside modelDir', async (t) => {
  const modelDir = await fixture(t);
  const singleBytes = Buffer.from('0123456789abcdef');
  const ranges = [];
  const server = createServer((request, response) => {
    const range = request.headers.range || '';
    ranges.push({ url: request.url, range });
    if (request.url === '/single.bin') {
      const offset = range ? Number(range.match(/bytes=(\d+)-/)?.[1] || 0) : 0;
      response.writeHead(offset ? 206 : 200, {
        'content-length': singleBytes.length - offset,
        ...(offset ? { 'content-range': `bytes ${offset}-${singleBytes.length - 1}/${singleBytes.length}` } : {}),
      });
      response.end(singleBytes.subarray(offset));
      return;
    }
    const file = decodeURIComponent(request.url.slice(1));
    const full = Buffer.from(`full:${file}`);
    const offset = range ? Number(range.match(/bytes=(\d+)-/)?.[1] || 0) : 0;
    response.writeHead(offset ? 206 : 200, { 'content-length': full.length - offset });
    response.end(full.subarray(offset));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const admin = new AsrAdmin({ config: { asrModelDir: modelDir } });

  await touch(join(modelDir, 'ggml-tiny.bin.part'), '0123');
  const single = await admin.downloadModel({ id: 'ggml-tiny.bin', url: `${baseUrl}/single.bin` });
  assert.equal(await readFile(single.path, 'utf8'), singleBytes.toString());
  assert.ok(ranges.some((item) => item.url === '/single.bin' && item.range === 'bytes=4-'));

  await touch(join(modelDir, 'fun-asr-nano', 'config.yaml.part'), 'full:con');
  const multi = await admin.downloadModel({ id: 'fun-asr-nano', baseUrl });
  assert.equal(multi.downloaded, true);
  assert.ok(multi.path.startsWith(modelDir));
  assert.equal(await readFile(join(modelDir, 'fun-asr-nano', 'config.yaml'), 'utf8'), 'full:config.yaml');
  assert.equal(await readFile(join(modelDir, 'fun-asr-nano', 'Qwen3-0.6B', 'vocab.json'), 'utf8'), 'full:Qwen3-0.6B/vocab.json');
  assert.ok(ranges.some((item) => item.url === '/config.yaml' && item.range === 'bytes=8-'));
});

test('active native backend model is protected from deletion and inactive model can be removed', async (t) => {
  const modelDir = await fixture(t);
  const definition = ASR_MODEL_CATALOG.find((entry) => entry.id === 'sensevoice');
  assert.ok(definition);
  await completeEntry(definition, modelDir);
  const admin = new AsrAdmin({ config: { asrModelDir: modelDir, asrBackend: 'sensevoice' } });
  const blocked = await admin.deleteModel({ id: 'sensevoice' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /正在使用/);
  await stat(join(modelDir, 'sensevoice', 'model.int8.onnx'));

  admin.config.asrBackend = 'whispercpp';
  const removed = await admin.deleteModel({ id: 'sensevoice' });
  assert.equal(removed.ok, true);
  assert.equal(removed.catalog.entries.find((entry) => entry.id === 'sensevoice').downloaded, false);
});
