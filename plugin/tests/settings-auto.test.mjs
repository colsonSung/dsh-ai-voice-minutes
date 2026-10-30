import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const host = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('settings does not force speaker count or fixed domain hotwords', () => {
  assert.doesNotMatch(client, /settingField\('speakers'/);
  assert.doesNotMatch(client, /settingField\('hotwords'/);
  assert.doesNotMatch(client, /settingArea\('hotwords'/);
  assert.doesNotMatch(client, /settings\.hotwordsHint/);
  assert.doesNotMatch(host, /fields\.speakers\s*=/);
  assert.doesNotMatch(host, /fields\.prompt\s*=\s*opts\.hotwords\s*\|\|\s*this\.config\.hotwords/);
});
