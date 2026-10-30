import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the library table grid matches the number of rendered cells', () => {
  const grid = source.match(/\.mvm-library-row\{display:grid;grid-template-columns:([^;]+);/);
  assert.ok(grid, 'the row grid template exists');
  const columns = grid[1].trim().split(/\s+/);
  assert.equal(columns.length, 8, 'select, title, created, duration, creator, source, size and actions');
  assert.match(source, /\.mvm-library-row\{[^}]*min-width:1\d{3}px/);
});

test('sizes are formatted and the delete action has its own column', () => {
  assert.match(source, /formatBytes\(meeting\.size\)/);
  assert.match(source, /mvm-library-actions/);
});
