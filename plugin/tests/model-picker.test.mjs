import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { apply } from '../index.js';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const host = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('translation model can be picked from the models the server exposes', () => {
  assert.match(client, /callHost\('list-models'/);
  assert.match(client, /settings\.loadModels/);
  assert.match(client, /translationModel/);
  assert.match(host, /async listModels\(/);
  assert.match(host, /case 'list-models'/);
});

test('a backend that rejects reasoning_effort is retried without it', () => {
  assert.match(host, /reasoning_effort/);
  assert.match(host, /delete retry\.reasoning_effort/);
});

test('list-models returns the ids reported by the configured endpoint', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qwen3.6-35b-a3b' }, { id: 'qwen3.5-4b-mtp' }] }));
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
  const result = await service.listModels({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.models, ['qwen3.6-35b-a3b', 'qwen3.5-4b-mtp']);
});
