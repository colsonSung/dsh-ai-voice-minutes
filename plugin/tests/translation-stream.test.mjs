import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

function streamingServer(words, options = {}) {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (options.fail) {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('no streaming here');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const word of words) {
      const payload = { choices: [{ delta: { content: word } }] };
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-stream-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  }, { desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {} } });
  const routes = new Map();
  service.config.dataDir = dataDir;
  await service.readSettings();
  return { service, routes };
}

const routes = new Map();

test('the translation arrives word by word while the model is still writing', async (t) => {
  const { baseUrl, server } = await streamingServer(['I am ', 'not sure ', 'tonight.']);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { service } = await fixture(t);
  service.config.translationProvider = 'lmstudio';
  service.config.translationBaseUrl = baseUrl;
  service.config.translationModel = 'hy-mt2-7b';
  service.config.translationFallbackEnabled = false;

  const seen = [];
  const result = await service.translateStream('不知道今天晚上来不来。', { sourceLanguage: 'zh', targetLanguage: 'en' }, (partial) => seen.push(partial));

  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.translation, 'I am not sure tonight.');
  assert.ok(seen.length >= 2, `the text grows while the model writes, got ${seen.length} updates`);
  assert.ok(seen[0].length < result.result.translation.length, 'the first update is not the whole sentence');
  assert.ok(seen.at(-1) === result.result.translation, 'the last update is the finished text');
  assert.ok(seen.every((text, index) => index === 0 || text.startsWith(seen[index - 1])), 'the text only ever grows');
});

test('a server that cannot stream still produces a translation', async (t) => {
  const { baseUrl, server } = await streamingServer([], { fail: true });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { service } = await fixture(t);
  service.config.translationProvider = 'lmstudio';
  service.config.translationBaseUrl = baseUrl;
  service.config.translationModel = 'hy-mt2-7b';
  service.config.translationFallbackEnabled = false;

  const result = await service.translateStream('不知道今天晚上来不来。', { sourceLanguage: 'zh', targetLanguage: 'en' }, () => {});
  // The plain path is tried next; with no reachable endpoint this must fail
  // clearly instead of hanging or throwing.
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.code, 'the failure carries a code');
  assert.match(String(result.error.message), /翻译模型没有返回内容|不可达|流式|HTTP/);
});
