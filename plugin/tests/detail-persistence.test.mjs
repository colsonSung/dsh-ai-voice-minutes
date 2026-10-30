import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('favorites persist and shared meeting links reopen the meeting', () => {
  assert.match(source, /const onToggleFavorite\s*=/);
  assert.match(source, /favorite:\s*nextFavorite/);
  assert.match(source, /setFavorite\(Boolean\(meeting\.favorite\)\)/);
  assert.ok(source.includes("new URLSearchParams(globalThis.window?.location?.search || '').get('meeting')"));
  assert.match(source, /searchParams\.set\('meeting'/);
  assert.match(source, /searchParams\.delete\('meeting'\)/);
});
