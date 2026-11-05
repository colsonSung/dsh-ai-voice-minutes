import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';
import { AsrAdmin } from '../asr-admin.js';

function capturePlugin() {
  const routes = new Map();
  let service;
  apply({
    provide(name, value) {
      if (name === 'minutes') service = value;
    },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) {
        callback({
          commands: { register: () => () => {} },
          effect: (register) => register(),
        });
      }
      if (dependencies.includes('connection')) {
        callback({
          connection: {
            fetch: {
              register(definition) {
                routes.set(definition.path, definition);
                return () => {};
              },
            },
          },
          effect: (register) => register(),
        });
      }
    },
  });
  return { route: routes.get(ROUTE), service };
}

async function invoke(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  }));
  return { status: response.status, body: await response.json() };
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-voice-minutes-switch-'));
  const modelDir = join(dataDir, 'models');
  await mkdir(modelDir, { recursive: true });
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const captured = capturePlugin();
  captured.service.config.dataDir = dataDir;
  captured.service.config.asrModelDir = modelDir;
  return { ...captured, dataDir, modelDir };
}

async function writeModel(modelDir, id, files) {
  const target = join(modelDir, id);
  await mkdir(target, { recursive: true });
  for (const name of files) await writeFile(join(target, name), 'x');
  return target;
}

test('ASR admin resolves a live config so a model switch is visible right away', async () => {
  const live = { asrBackend: 'whispercpp', whisperCppModel: '/models/ggml-large-v3.bin' };
  const admin = new AsrAdmin({ config: () => live });
  assert.equal(admin.backend(), 'whispercpp');
  live.asrBackend = 'sensevoice';
  assert.equal(admin.backend(), 'sensevoice');
});

test('selecting a model updates the backend and the reported active model', async (t) => {
  const { route, modelDir } = await fixture(t);
  await writeModel(modelDir, 'sensevoice', ['model.int8.onnx', 'model.onnx', 'tokens.txt']);
  await writeFile(join(modelDir, 'ggml-large-v3.bin'), 'x');

  const before = await invoke(route, 'asr-status');
  assert.equal(before.body.ok, true);
  assert.equal(before.body.result.backend, 'whispercpp');

  const switched = await invoke(route, 'asr-select-model', { id: 'sensevoice' });
  assert.equal(switched.body.ok, true, JSON.stringify(switched.body));
  assert.equal(switched.body.result.settings.asrBackend, 'sensevoice');
  assert.equal(switched.body.result.status.backend, 'sensevoice');
  assert.equal(switched.body.result.status.catalog.activeId, 'sensevoice');

  const after = await invoke(route, 'asr-status');
  assert.equal(after.body.result.backend, 'sensevoice');
  assert.equal(after.body.result.catalog.activeId, 'sensevoice');
});

test('selecting a whispercpp model points the service at that file', async (t) => {
  const { route, modelDir } = await fixture(t);
  await writeFile(join(modelDir, 'ggml-large-v3.bin'), 'x');
  await writeFile(join(modelDir, 'ggml-large-v3-turbo.bin'), 'x');

  const switched = await invoke(route, 'asr-select-model', { id: 'ggml-large-v3-turbo.bin' });
  assert.equal(switched.body.ok, true, JSON.stringify(switched.body));
  assert.equal(switched.body.result.settings.asrBackend, 'whispercpp');
  assert.equal(switched.body.result.settings.whisperCppModel, join(modelDir, 'ggml-large-v3-turbo.bin'));
  assert.equal(switched.body.result.status.catalog.activeId, 'ggml-large-v3-turbo.bin');
});

test('selecting a model that is not on disk fails instead of silently doing nothing', async (t) => {
  const { route } = await fixture(t);
  const switched = await invoke(route, 'asr-select-model', { id: 'ggml-large-v3-turbo.bin' });
  assert.equal(switched.body.ok, false);
  assert.equal(switched.body.error.code, 'minutes/asr-model-missing');
});

test('the diarization model is not offered as an ASR model to switch to', async (t) => {
  const { route, modelDir } = await fixture(t);
  await writeModel(modelDir, 'ecapa', ['classifier.ckpt', 'embedding_model.ckpt']);
  const switched = await invoke(route, 'asr-select-model', { id: 'ecapa' });
  assert.equal(switched.body.ok, false);
  assert.equal(switched.body.error.code, 'minutes/asr-model-not-selectable');
});

test('the settings write never reverts a model that was switched outside the form', async (t) => {
  const { route, modelDir, dataDir } = await fixture(t);
  await writeModel(modelDir, 'sensevoice', ['model.int8.onnx', 'model.onnx', 'tokens.txt']);
  await invoke(route, 'asr-select-model', { id: 'sensevoice' });

  const saved = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dataDir, 'settings.json'), 'utf8')));
  assert.equal(saved.asrBackend, 'sensevoice');
  assert.equal(saved.senseVoiceDir, join(modelDir, 'sensevoice'));
});

test('the int8 SenseVoice model is enough for the recognizer to be ready', async (t) => {
  const { route, modelDir } = await fixture(t);
  await writeModel(modelDir, 'sensevoice', ['model.int8.onnx', 'tokens.txt']);
  const status = await invoke(route, 'asr-status');
  const entry = status.body.result.catalog.entries.find((item) => item.id === 'sensevoice');
  assert.equal(entry.downloaded, true, 'the working model is not offered for download again');
});
