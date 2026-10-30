import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('translation renders progressively below each original line with distinct styling', () => {
  assert.match(source, /translationProgress/);
  assert.match(source, /translatedLines\[index\]/);
  assert.match(source, /mvm-translation-line/);
  assert.match(source, /mvm-translation-skeleton/);
  assert.match(source, /@keyframes mvm-shimmer/);
  assert.match(source, /lines:\s*\[\.\.\.translatedLines\]/);
});
