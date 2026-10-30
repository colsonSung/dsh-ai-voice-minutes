import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('translation uses its own LM Studio endpoint and disables reasoning', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'Account opening' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-translation-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    llmBaseUrl: 'http://127.0.0.1:9/v1',
    llmModel: 'unrelated-minutes-model',
    translationBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    translationPath: '/chat/completions',
    translationProvider: 'lmstudio',
    translationModel: 'qwen3.5-4b-mtp',
    translationReasoningEffort: 'none',
    translationFallbackEnabled: false,
  }), 'utf8');

  const service = createService();
  service.config.dataDir = dataDir;
  const result = await service.translate('开户流程', { sourceLanguage: 'zh', targetLanguage: 'en' });
  assert.equal(result.ok, true);
  assert.equal(result.result.translation, 'Account opening');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].body.model, 'qwen3.5-4b-mtp');
  assert.equal(requests[0].body.reasoning_effort, 'none');
  assert.equal(requests[0].headers.authorization, undefined);
});
