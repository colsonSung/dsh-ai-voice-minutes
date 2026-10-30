import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('settings renders as an accessible modal with backdrop and Escape dismissal', () => {
  assert.match(source, /className:\s*'mvm-settings-backdrop'/);
  assert.match(source, /role:\s*'dialog'/);
  assert.match(source, /'aria-modal':\s*'true'/);
  assert.match(source, /event\.key\s*===\s*'Escape'/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /mvm-settings-modal/);
});
