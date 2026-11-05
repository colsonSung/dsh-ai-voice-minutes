import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { apply } from '../index.js';

const run = promisify(execFile);

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

test('translation has an independent key, endpoint, model, and inference settings', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'Translation' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => run('security', ['delete-generic-password', '-s', 'translation-api-key']).catch(() => {}));

  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-provider-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    translationProvider: 'siliconflow',
    translationBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    translationModel: 'cloud-translation-model',
    translationTemperature: 0.15,
    translationMaxTokens: 321,
    translationReasoningEffort: 'none',
    translationFallbackEnabled: false,
  }), 'utf8');
  const settings = await service.writeSettings({ translationApiKey: 'test-translation-key' });
  assert.equal(settings.translationApiKeySet, true);
  const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved, 'translationApiKey'), false);
  assert.equal(Object.hasOwn(saved, 'apiKey'), false);
  assert.equal(Object.hasOwn(saved, 'siliconflowApiKey'), false);

  const result = await service.translate('测试', { sourceLanguage: 'zh', targetLanguage: 'en' });
  assert.equal(result.ok, true);
  assert.match(requests[0].headers.authorization, /^Bearer .+/);
  assert.equal(requests[0].body.model, 'cloud-translation-model');
  assert.equal(requests[0].body.temperature, 0.15);
  assert.equal(requests[0].body.max_tokens, 321);
  assert.equal(requests[0].body.reasoning_effort, 'none');
});
