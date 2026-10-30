import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');

async function call(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  }));
  return response.json();
}

test('each model in the dropdown has its own download button', () => {
  assert.match(client, /mvm-model-option/);
  assert.match(client, /mvm-model-option-actions/);
  assert.match(client, /asr-download-model', \{ id: entry\.id \}/);
  assert.doesNotMatch(client, /<select[\s\S]{0,400}asrModelChoice/);
});

test('model directory and launcher have quick open buttons', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-open-path-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const opened = [];
  let route;
  apply({
    provide() {},
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  }, { openPath: async (target) => { opened.push(target); } });
  const body = await call(route, 'open-path', { path: join(dataDir, 'models') });
  assert.equal(body.ok, true);
  assert.equal(opened.length, 1);
  assert.match(client, /callHost\('open-path'/);
  assert.match(client, /settings\.asr\.openModelDir/);
  assert.match(client, /settings\.asr\.openLauncher/);
});

test('template cards no longer show a VIP badge', () => {
  assert.doesNotMatch(client, /mvm-template-vip/);
  assert.doesNotMatch(client, /'VIP'/);
});
