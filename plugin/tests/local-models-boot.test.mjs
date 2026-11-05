import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';
import { LocalLlmAdmin } from '../llm-admin.js';

/**
 * A fake config function plus every call the admin makes, so the assertions are
 * about behaviour instead of a real LM Studio installation.
 */
function fakeLlm({ config = {}, serverUp: initialUp = false, resident = [], binary = '/fake/lms', failLoad = '' } = {}) {
  let serverUp = initialUp;
  const calls = [];
  const probes = [];
  const admin = new LocalLlmAdmin({
    config: () => ({
      translationProvider: 'lmstudio',
      translationBaseUrl: 'http://127.0.0.1:6121/v1',
      translationModel: 'hy-mt2-7b',
      llmProvider: 'minimax',
      llmBaseUrl: 'https://api.minimaxi.com/v1',
      llmModel: 'MiniMax-M3.1-Flash',
      ...config,
      // A configured path wins over discovery, so the fake never touches the
      // real LM Studio CLI that happens to be installed on this machine.
      lmLmsBinary: binary,
    }),
    exists: async (file) => Boolean(binary) && file === binary,
    fetch: async (url) => {
      probes.push(url);
      if (!serverUp) throw new Error('ECONNREFUSED');
      return {
        ok: true,
        json: async () => ({ data: resident.map((id) => ({ id })) }),
      };
    },
    run: async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === 'ps') return { stdout: JSON.stringify(resident.map((id) => ({ identifier: id }))), stderr: '' };
      if (args[0] === 'server') { serverUp = true; return { stdout: 'started', stderr: '' }; }
      if (args[0] === 'load') {
        if (failLoad) throw new Error(failLoad);
        resident.push(args[1]);
        return { stdout: 'loaded', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    },
  });
  return { admin, calls, probes, resident };
}

test('only a local provider becomes a target, and a cloud one is left alone', () => {
  const { admin } = fakeLlm();
  assert.deepEqual(admin.targets(), [
    { role: 'translation', model: 'hy-mt2-7b', baseUrl: 'http://127.0.0.1:6121' },
  ], 'the cloud summarizer is not a local target');

  const cloud = fakeLlm({
    config: {
      translationProvider: 'minimax',
      translationBaseUrl: 'https://api.minimaxi.com/v1',
      translationModel: 'MiniMax-M3.1-Flash',
    },
  });
  assert.deepEqual(cloud.admin.targets(), [], 'a cloud-only setup has nothing to start');
});

test('ensuring the local models starts the server and loads the missing model', async () => {
  const { admin, calls } = fakeLlm({ serverUp: false, resident: [] });
  const result = await admin.ensure();
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['/fake/lms', 'server', 'start'], 'the server is started first');
  assert.ok(calls.some((call) => call[1] === 'load' && call[2] === 'hy-mt2-7b'), 'the configured model is loaded');
  assert.equal(result.loaded.find((entry) => entry.model === 'hy-mt2-7b').loaded, true);
});

test('a model that is already resident is not loaded a second time', async () => {
  const { admin, calls } = fakeLlm({ serverUp: true, resident: ['hy-mt2-7b'] });
  const result = await admin.ensure();
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[1] === 'load'), false, 'no redundant load');
  assert.equal(result.loaded[0].alreadyLoaded, true);
});

test('a running server is not restarted', async () => {
  const { admin, calls } = fakeLlm({ serverUp: true, resident: [] });
  await admin.ensure();
  assert.equal(calls.some((call) => call[1] === 'server'), false, 'an already running server is left alone');
});

test('no LM Studio means the ensure reports why instead of throwing', async () => {
  const { admin } = fakeLlm({ binary: '' });
  const result = await admin.ensure();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'lms-missing');
});

test('a failed load is reported, not thrown', async () => {
  const { admin } = fakeLlm({ serverUp: true, failLoad: 'insufficient resources' });
  const result = await admin.ensure();
  const entry = result.loaded.find((item) => item.model === 'hy-mt2-7b');
  assert.equal(entry.loaded, false);
  assert.match(entry.error, /insufficient resources/);
});

test('status separates "server answers" from "the model is resident"', async () => {
  const { admin } = fakeLlm({ serverUp: true, resident: [] });
  const status = await admin.status();
  assert.equal(status.online, true);
  assert.equal(status.ready, false, 'a model on disk is not a model in memory');
  assert.equal(status.installed, true);

  const warm = fakeLlm({ serverUp: true, resident: ['hy-mt2-7b'] });
  const warmStatus = await warm.admin.status();
  assert.equal(warmStatus.ready, true, 'a resident model is ready');
  assert.deepEqual(warmStatus.loaded, ['hy-mt2-7b']);
});

/**
 * The regression that mattered: the boot hook read `asrAutoStart` before the
 * settings file had been loaded, so it always saw the default (false) and the
 * service never started by itself.
 */
test('a host start reads the saved settings before deciding to autostart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-boot-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrAutoStart: true,
    llmAutoStart: true,
    translationProvider: 'lmstudio',
    translationBaseUrl: 'http://127.0.0.1:6121/v1',
    translationModel: 'hy-mt2-7b',
  }), 'utf8');

  const asrStarts = [];
  const llmEnsures = [];
  let service = null;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  }, {
    dataDir,
    autoStartLocalServices: true,
    asrAdmin: {
      async start() { asrStarts.push(Date.now()); return { started: true }; },
      async status() { return { online: true }; },
    },
    llmAdmin: {
      async ensure() { llmEnsures.push(Date.now()); return { ok: true }; },
      async status() { return { ready: true, targets: [] }; },
    },
  });
  // The boot hook runs on its own; give it the tick it needs to read the file.
  for (let attempt = 0; attempt < 100 && !llmEnsures.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(asrStarts.length, 1, 'the saved asrAutoStart is honoured');
  assert.equal(llmEnsures.length, 1, 'the saved llmAutoStart is honoured');
});

test('autostart stays off when the settings say so', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-boot-off-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrAutoStart: false,
    llmAutoStart: false,
  }), 'utf8');

  const asrStarts = [];
  const llmEnsures = [];
  let service = null;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  }, {
    dataDir,
    autoStartLocalServices: true,
    asrAdmin: { async start() { asrStarts.push(1); return {}; }, async status() { return {}; } },
    llmAdmin: { async ensure() { llmEnsures.push(1); return {}; }, async status() { return {}; } },
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(asrStarts.length, 0, 'a disabled switch starts nothing');
  assert.equal(llmEnsures.length, 0, 'a disabled switch starts nothing');
});
