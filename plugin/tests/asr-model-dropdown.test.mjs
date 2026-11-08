import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the caption model is one compact select, and the library is management only', () => {
  // The ASR tab carries a single select (the family is an optgroup); the
  // expanded dropdown menu and its trigger are gone, and downloads/removals
  // live in the services tab's library list.
  assert.match(source, /'aria-label': t\('settings\.asr\.liveModel'\)/);
  assert.doesNotMatch(source, /mvm-model-trigger/);
  assert.doesNotMatch(source, /mvm-model-menu/);
  assert.match(source, /className: 'mvm-model-library'/);
  assert.match(source, /onAsrModelChoice/);
  assert.match(source, /settings\.asr\.inUse/);
  assert.match(source, /settings\.asr\.notDownloaded/);
  assert.doesNotMatch(source, /mvm-model-row/);
});
