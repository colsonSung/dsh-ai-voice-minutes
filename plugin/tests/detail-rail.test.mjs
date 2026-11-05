import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('detail page has a right rail with recent meeting summaries and an AI history assistant', () => {
  // The rail is a fixed drawer on the right edge, not a column in the page
  // grid: it must be able to open over the transcript without reflowing it.
  assert.match(source, /mvm-assistant-drawer/);
  assert.match(source, /\.mvm-assistant-drawer\{position:fixed/);
  assert.match(source, /\.mvm-assistant-drawer\{[^}]*right:0/);
  assert.match(source, /const renderRecentMeetings = \(\) =>/);
  assert.match(source, /const renderRailMessages = \(\) =>/);
  assert.match(source, /const renderRailComposer = \(\) =>/);
  assert.match(source, /callHost\('ask-history'/);
  assert.match(source, /mvm-recent-item/);
  assert.match(source, /mvm-chat-bubble/);
  assert.match(source, /mvm-rail-tile/);
  assert.match(source, /history\.scopeAll/);
});
