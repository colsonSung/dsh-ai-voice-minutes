import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('offline saves retain the uploaded audioId for later deletion', () => {
  assert.match(source, /setAudioId\(stored\.id\)/);
  assert.match(source, /audioId:\s*audioId\s*\|\|\s*undefined/);
});
