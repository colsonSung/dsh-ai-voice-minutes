import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the ASR model library is a compact dropdown instead of an expanded list', () => {
  assert.match(source, /className: 'mvm-model-picker'/);
  assert.match(source, /asrModelChoice/);
  assert.match(source, /onAsrModelChoice/);
  assert.match(source, /settings\.asr\.inUse/);
  assert.match(source, /settings\.asr\.notDownloaded/);
  assert.doesNotMatch(source, /mvm-model-row/);
});
