import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

function createService() {
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  });
  return service;
}

test('offline meeting audio streams the original file with its media type', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-offline-audio-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  const bytes = Buffer.from([1, 2, 3, 4]);
  await writeFile(join(dataDir, 'audio', 'audio-123.m4a'), bytes);
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === '/api/ai-minutes/meeting-audio') route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  });
  service.config.dataDir = dataDir;
  assert.ok(route, 'offline meeting audio route is registered');
  const response = await route.fetch(new Request('http://localhost/api/ai-minutes/meeting-audio?id=audio-123'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mp4');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
});

test('translation supports all reference target languages', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-language-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  // A model name that is not Hy-MT, so the generic target language prompt is used.
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    translationBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    translationModel: 'test-model',
  }), 'utf8');
  const service = createService();
  service.config.dataDir = dataDir;
  for (const targetLanguage of ['zh-Hant', 'yue', 'ja', 'ko', 'th', 'id']) {
    const result = await service.translate('测试', { sourceLanguage: 'zh', targetLanguage });
    assert.equal(result.ok, true);
  }
  const prompts = requests.map((request) => request.messages[0].content);
  for (const [index, language] of ['Traditional Chinese', 'Cantonese', 'Japanese', 'Korean', 'Thai', 'Indonesian'].entries()) {
    assert.ok(prompts[index].includes(language), `${language} prompt is used`);
  }
});
