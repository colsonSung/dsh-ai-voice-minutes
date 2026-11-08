import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

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
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-voice-minutes-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const captured = capturePlugin();
  captured.service.config.dataDir = dataDir;
  return { ...captured, dataDir };
}

test('settings read uses the Client response envelope', async (t) => {
  const { route } = await fixture(t);
  const { status, body } = await invoke(route, 'settings');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.result.asrBaseUrl, 'string');
});

test('settings write uses the Client response envelope', async (t) => {
  const { route, dataDir } = await fixture(t);
  const { body } = await invoke(route, 'settings', { settings: { llmModel: 'test-model' } });
  assert.equal(body.ok, true);
  assert.equal(body.result.llmModel, 'test-model');
  const saved = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dataDir, 'settings.json'), 'utf8')));
  assert.equal(saved.llmModel, 'test-model');
  assert.equal(Object.hasOwn(saved, 'apiKey'), false);
});

test('health returns an envelope and loads saved endpoints before probing', async (t) => {
  const { route, dataDir } = await fixture(t);
  const savedLlmUrl = 'http://127.0.0.1:9/v1';
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrBaseUrl: 'http://127.0.0.1:9',
    llmBaseUrl: savedLlmUrl,
    llmModel: 'saved-model',
  }), 'utf8');
  const { body } = await invoke(route, 'health');
  assert.equal(body.ok, true);
  assert.equal(body.result.settings.llmBaseUrl, savedLlmUrl);
  assert.equal(body.result.settings.llmModel, 'saved-model');
  assert.equal(typeof body.result.asr.alive, 'boolean');
  assert.equal(typeof body.result.llm.alive, 'boolean');
});

test('chat initializes the saved LLM endpoint before requesting a completion', async (t) => {
  const { service, dataDir } = await fixture(t);
  const savedLlmUrl = 'http://127.0.0.1:9/v1';
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    llmBaseUrl: savedLlmUrl,
    llmModel: 'saved-model',
  }), 'utf8');
  await service.chat([{ role: 'user', content: 'test' }]);
  assert.equal(service.getSettings().llmBaseUrl, savedLlmUrl);
  assert.equal(service.getSettings().llmModel, 'saved-model');
});

test('transcription uses a long-running HTTP transport without global fetch', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        text: '转写成功',
        segments: [{ start: 0, end: 1, text: '转写成功', speaker: 'S1' }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { service, dataDir } = await fixture(t);
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrBaseUrl: `http://127.0.0.1:${server.address().port}`,
    asrPath: '/v1/audio/transcriptions',
  }), 'utf8');
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('global fetch disabled'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await service.transcribe(
    { base64: wav.toString('base64') },
    { filename: 'meeting.wav' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.transcript, '转写成功');
  assert.equal(requests.length, 1);
  assert.match(requests[0].headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.ok(requests[0].body.includes(wav));
});

test('existing error envelopes remain unchanged', async (t) => {
  const { route } = await fixture(t);
  const { body } = await invoke(route, 'transcribe', { audio: {} });
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'minutes/no-audio');
});

test('voice profiles can be deleted through the Host API', async (t) => {
  const { route, service } = await fixture(t);
  await service.saveVoiceProfiles([{ id: 'voice-keep', name: '保留声音', embedding: [1], exemplars: [[1]] }]);
  const { body } = await invoke(route, 'voice-delete', { profileId: 'voice-keep' });
  assert.equal(body.ok, true);
  assert.equal(body.result.deletedId, 'voice-keep');
  assert.deepEqual(body.result.profiles, []);
  assert.deepEqual(await service.loadVoiceProfiles(), []);
});
