import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../native/asr/local_asr_server.py', import.meta.url), 'utf8');

test('speakers can be labelled and the voice book is wired to the client', () => {
  assert.match(client, /callHost\('voice-save'/);
  assert.match(client, /callHost\('voice-rename'/);
  assert.match(client, /callHost\('voices'/);
  assert.match(client, /const renderSpeakerChip = \(speaker, letters, utteranceIndex = null\) =>/);
  assert.match(client, /speakerLabels\[key\]/);
  assert.match(client, /mvm-voice-list/);
  assert.match(client, /mvm-speaker-chip/);
  assert.match(client, /voiceprints: result\.voiceprints/);
  assert.match(client, /renderSpeakerList/);
  assert.match(client, /mvm-speaker-popover/);
  assert.match(client, /speakerListOpen/);
});

test('the voice library supports correction and deletion', () => {
  assert.match(client, /voice-rename/);
  // Deletion is destructive, so it goes through a host route and a second
  // confirmation step instead of firing from the first icon press.
  assert.match(client, /callHost\('voice-delete'/);
  assert.match(client, /mvm-voicebook-delete/);
  assert.match(client, /mvm-voicebook-confirm/);
  assert.match(client, /voice\.deleteConfirm/);
  assert.match(client, /commitVoiceDelete/);
});

test('the local ASR service exposes per-speaker voiceprints', () => {
  assert.match(server, /"voiceprints"/);
  assert.match(server, /STATE\["voiceprints"\] = averaged/);
});
