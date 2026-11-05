import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('detail workspace fills the available width and height with an independently scrolling tab body', () => {
  assert.match(source, /\.mvm-detail-page\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0[^}]*display:flex[^}]*overflow:hidden/);
  assert.match(source, /\.mvm-detail-tab-content\{flex:1;min-height:0;overflow-y:auto/);
  assert.match(source, /\.mvm-detail-page\{[^}]*max-width:none/);
  assert.doesNotMatch(source, /\.mvm-detail-page\{[^}]*max-width:1240px/);
  assert.doesNotMatch(source, /\.mvm-transcript\{max-height:420px/);
});
