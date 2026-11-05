import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const host = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('two translation models can be compared on the same sentences', () => {
  assert.match(client, /callHost\('compare-translation'/);
  assert.match(client, /history\.compareTitle/);
  assert.match(host, /async compareTranslation\(/);
  assert.match(host, /case 'compare-translation'/);
});

test('comparison reports latency and detects chatty or empty output', async (t) => {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const model = body.model;
      if (model === 'chatty') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: 'Here is the translation: 你好' } }] }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '你好' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-compare-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  service.config.dataDir = dataDir;
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    translationBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    translationProvider: 'lmstudio',
  }), 'utf8');
  const result = await service.compareTranslation({
    sentences: ['你好', '世界'],
    models: ['clean', 'chatty'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.results.length, 2);
  const clean = result.result.results.find((item) => item.model === 'clean');
  const chatty = result.result.results.find((item) => item.model === 'chatty');
  assert.equal(clean.samples.length, 2);
  assert.equal(clean.preambleHits, 0);
  assert.equal(chatty.preambleHits, 2);
  assert.ok(clean.avgMs >= 0);
});
