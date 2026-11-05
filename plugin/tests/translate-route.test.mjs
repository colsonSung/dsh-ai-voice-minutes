import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

test('translate method is callable through the Host route', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'Translated text' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-translate-route-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  service.config.dataDir = dataDir;
  service.config.translationBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'translate', payload: { text: 'Test', options: { sourceLanguage: 'en', targetLanguage: 'zh' } } }),
  }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.translation, 'Translated text');
});
