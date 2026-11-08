import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PLUGIN = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** The files the plugin actually loads at runtime, host half and browser half. */
const RUNTIME_MODULES = [
  'index.js', 'client.js', 'live.js', 'realtime.js', 'overlay.js',
  'asr-admin.js', 'llm-admin.js',
];

/**
 * The `files` array decides what a git install carries: pnpm packs the
 * package with that list, so a module missing from it is a module the
 * installed plugin cannot import. llm-admin.js stayed out of the list for
 * two releases, and every market install of the plugin was broken.
 */
test('every module the plugin imports at runtime is packed', async () => {
  const packed = pkg.files || [];
  const missing = [];
  for (const name of RUNTIME_MODULES) {
    const source = await readFile(new URL(name, PLUGIN), 'utf8');
    for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
      const target = match[1].slice(2);
      const covered = packed.some((entry) => entry === target || entry.endsWith('*' + target));
      if (!covered) missing.push(name + ' imports ' + match[1]);
    }
  }
  assert.deepEqual(missing, [], 'these imports are not packed: ' + missing.join(', '));
});

test('the packed set covers every module the package entry points expose', () => {
  const packed = pkg.files || [];
  for (const target of [pkg.exports['.'], pkg.exports['./client']]) {
    const relative = String(target).slice(2);
    assert.ok(
      packed.some((entry) => entry === relative || entry.endsWith('*' + relative)),
      relative + ' is exported but not packed',
    );
  }
});
