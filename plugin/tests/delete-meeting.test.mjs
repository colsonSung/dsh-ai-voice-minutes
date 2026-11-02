import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

function createService() {
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  });
  return service;
}

async function missing(path) {
  await assert.rejects(stat(path), { code: 'ENOENT' });
}

test('delete removes the meeting index, realtime directory, and linked audio', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-delete-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const id = 'realtime-delete-1';
  await mkdir(join(dataDir, 'meetings'), { recursive: true });
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await mkdir(join(dataDir, 'realtime', id), { recursive: true });
  await writeFile(join(dataDir, 'meetings', `${id}.json`), JSON.stringify({ id, title: 'Delete me', audioId: 'audio-123' }));
  await writeFile(join(dataDir, 'audio', 'audio-123.m4a'), 'audio');
  await writeFile(join(dataDir, 'realtime', id, 'mic.pcm'), 'mic');
  await writeFile(join(dataDir, 'realtime', id, 'system.pcm'), 'system');
  await writeFile(join(dataDir, 'realtime', id, 'checkpoint.json'), '{}');
  await writeFile(join(dataDir, 'realtime', id, 'events.jsonl'), '{}\n');

  const service = createService();
  service.config.dataDir = dataDir;
  const result = await service.deleteMeeting(id);
  assert.equal(result.ok, true);
  assert.equal(result.result.realtimeDeleted, true);
  assert.equal(result.result.audioDeleted, true);
  await missing(join(dataDir, 'meetings', `${id}.json`));
  await missing(join(dataDir, 'realtime', id));
  await missing(join(dataDir, 'audio', 'audio-123.m4a'));

  const again = await service.deleteMeeting(id);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'minutes/not-found');
});

test('delete rejects path traversal without touching other files', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-delete-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const outside = join(dataDir, 'outside.json');
  await writeFile(outside, 'keep');
  const service = createService();
  service.config.dataDir = dataDir;
  const result = await service.deleteMeeting('../outside');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'minutes/invalid-id');
  assert.equal(await readFile(outside, 'utf8'), 'keep');
});

test('deleting a meeting and its original audio preserves voice profiles and backups byte-for-byte', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-delete-voices-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  await service.saveVoiceProfiles([{ id: 'voice-keep', name: 'Permanent', embedding: [1], exemplars: [[1]] }]);
  const backupDir = join(dataDir, 'voices', 'backups');
  const backupName = (await readdir(backupDir))[0];
  const primaryPath = join(dataDir, 'voices', 'profiles.json');
  const backupPath = join(backupDir, backupName);
  const primaryBefore = await readFile(primaryPath, 'utf8');
  const backupBefore = await readFile(backupPath, 'utf8');
  const id = 'meeting-delete-voice-1';
  await mkdir(join(dataDir, 'meetings'), { recursive: true });
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await writeFile(join(dataDir, 'meetings', `${id}.json`), JSON.stringify({ id, title: 'Delete audio', audioId: 'audio-voice-1' }));
  await writeFile(join(dataDir, 'audio', 'audio-voice-1.wav'), 'original audio');

  const deleted = await service.deleteMeeting(id);
  assert.equal(deleted.ok, true);
  await missing(join(dataDir, 'audio', 'audio-voice-1.wav'));
  assert.equal(await readFile(primaryPath, 'utf8'), primaryBefore);
  assert.equal(await readFile(backupPath, 'utf8'), backupBefore);
});
