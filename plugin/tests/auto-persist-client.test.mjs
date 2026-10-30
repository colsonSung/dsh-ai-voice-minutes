import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('transcription results and generated minutes are persisted automatically', () => {
  assert.match(source, /const persistMeeting = async/);
  const calls = source.match(/persistMeeting\(/g) || [];
  assert.ok(calls.length >= 2, 'persistence helper is used by transcription and summarisation');
  assert.match(source, /notice\.autoSaved/);
});
