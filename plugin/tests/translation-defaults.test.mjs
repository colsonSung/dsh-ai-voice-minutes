import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('translation defaults to the local model with the cloud model as the fallback', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-translation-defaults-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  // The local model speaks first: no network round trip on the caption path.
  assert.equal(service.config.translationProvider, 'lmstudio');
  assert.equal(service.config.translationModel, 'hy-mt2-7b');
  assert.equal(service.config.translationBaseUrl, 'http://127.0.0.1:6121/v1');
  assert.equal(service.config.translationFallbackEnabled, true);
  assert.equal(service.config.translationFallbackProvider, 'minimax');
  assert.equal(service.config.translationFallbackModel, 'MiniMax-M3.1-Flash');
  assert.equal(service.config.translationFallbackBaseUrl, 'https://api.minimaxi.com/v1');
});

test('a failed local translation falls back to the cloud model', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-translation-fallback-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    if (options.profile?.provider === 'lmstudio') return { ok: false, error: { message: 'primary unavailable' } };
    return { ok: true, result: { text: '`Translated text`' } };
  };
  const result = await service.translate('你好', { targetLanguage: 'en' });
  assert.equal(result.ok, true);
  assert.equal(result.result.translation, 'Translated text');
  assert.equal(result.result.provider, 'minimax');
  assert.equal(result.result.fallbackUsed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].profile.provider, 'lmstudio');
  assert.equal(calls[0].profile.model, 'hy-mt2-7b');
  assert.equal(calls[1].profile.provider, 'minimax');
  assert.equal(calls[1].profile.model, 'MiniMax-M3.1-Flash');
});

test('the cloud fallback can be disabled without changing the primary provider', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-translation-no-fallback-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  service.config.translationFallbackEnabled = false;
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    return { ok: false, error: { message: 'primary unavailable' } };
  };
  const result = await service.translate('你好', { targetLanguage: 'en' });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile.provider, 'lmstudio');
});

test('minutes and Q&A default to the local general model with reasoning disabled', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-llm-defaults-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  assert.equal(service.config.llmProvider, 'lmstudio');
  assert.equal(service.config.llmBaseUrl, 'http://127.0.0.1:6121/v1');
  assert.equal(service.config.llmModel, 'qwen3.5-9b-mtp');
  assert.equal(service.config.llmReasoningEffort, 'none');
});


test('a local LLM that rejects json_object still returns structured minutes content', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      if (body.response_format?.type === 'json_object') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: "'response_format.type' must be 'json_schema' or 'text'" }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"local","topics":[],"chapters":[],"decisions":[],"todos":[],"viewpoints":[]}' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-local-json-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  service.config.llmProvider = 'lmstudio';
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const result = await service.chat([{ role: 'user', content: 'Summarize' }], { json: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(requests.length, 2, 'the unsupported response format is retried once');
  assert.equal(requests[1].response_format, undefined, 'the retry uses plain text');
  assert.match(result.result.text, /local/);
});
