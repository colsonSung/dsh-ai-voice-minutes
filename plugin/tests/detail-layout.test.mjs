import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('detail header uses a responsive grid and search gets a full-width row', () => {
  assert.match(source, /\.mvm-detail-header\{display:grid/);
  assert.match(source, /\.mvm-detail-search\{grid-column:1\/-1/);
  assert.match(source, /\.mvm-detail-actions\{display:flex;align-items:center;gap:8px;flex-wrap:wrap/);
});
