import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

function embedding(seed) {
  const vector = Array.from({ length: 16 }, (_, index) => Math.sin(seed + index));
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

test('a known voice is recognised automatically in a later meeting', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;

  const first = embedding(1);
  await service.saveVoiceProfiles([{ id: 'voice-known', name: '张三', embedding: first, createdAt: '', updatedAt: '' }]);
  const resolved = await service.resolveVoiceLabels({ '发言人 1': first });
  assert.equal(resolved.labels['发言人 1'], '张三');
  assert.equal(resolved.profiles['发言人 1'], 'voice-known');
});

test('an unknown voice becomes a nameless profile and can be named later', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-name-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const vector = embedding(2);

  const saved = await service.saveMeeting({
    id: 'meeting-voice-1', title: '声音标注会议',
    transcript: '逐字稿', voiceprints: { '发言人 1': vector },
  });
  assert.equal(saved.ok, true);
  const profiles = await service.loadVoiceProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, '');

  const labelled = await service.labelVoice({ meetingId: 'meeting-voice-1', speaker: '发言人 1', name: '李四' });
  assert.equal(labelled.ok, true);
  assert.equal(labelled.result.speakerLabels['发言人 1'], '李四');
  const stored = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-voice-1.json'), 'utf8'));
  assert.equal(stored.speakerLabels['发言人 1'], '李四');
  const updated = await service.loadVoiceProfiles();
  assert.equal(updated[0].name, '李四');

  const later = await service.resolveVoiceLabels({ '发言人 1': vector });
  assert.equal(later.labels['发言人 1'], '李四');
});

test('deleting a voice removes the profile and drops the meeting pointers', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-delete-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const vector = embedding(5);
  await service.saveMeeting({
    id: 'meeting-voice-3', title: '删除会议', transcript: 'B',
    voiceprints: { '发言人 1': vector },
  });
  const labelled = await service.labelVoice({ meetingId: 'meeting-voice-3', speaker: '发言人 1', name: '钱七' });
  assert.equal(labelled.ok, true);
  const profileId = labelled.result.profiles[0].id;

  const deleted = await service.deleteVoice({ profileId });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.result.deletedId, profileId);
  assert.deepEqual(deleted.result.profiles, []);
  assert.deepEqual(await service.loadVoiceProfiles(), []);

  const stored = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-voice-3.json'), 'utf8'));
  assert.equal(stored.speakerProfiles?.['发言人 1'], undefined,
    'the meeting no longer points at the deleted identity');
  assert.equal(stored.speakerLabels['发言人 1'], '钱七',
    'the transcript keeps the speaker name it was recorded with');

  // The same voice may be clustered again from a later recording, but it comes
  // back nameless: the deleted identity and its name are not revived.
  const later = await service.resolveVoiceLabels({ '发言人 1': vector });
  const recreated = later.known.find((profile) => profile.id === later.profiles['发言人 1']);
  assert.ok(recreated, 'the voice is clustered again');
  assert.equal(recreated.name, '');
  assert.equal(later.labels['发言人 1'], undefined, 'the deleted name is not applied again');
});

test('deleting an unknown voice fails without touching the book', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-delete-missing-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  await service.saveVoiceProfiles([{ id: 'voice-keep', name: '保留', embedding: [1], createdAt: '', updatedAt: '' }]);

  const missing = await service.deleteVoice({ profileId: 'voice-not-there' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'minutes/not-found');
  assert.equal((await service.loadVoiceProfiles()).length, 1, 'the book is untouched');

  const noId = await service.deleteVoice({});
  assert.equal(noId.ok, false);
  assert.equal(noId.error.code, 'minutes/voice-missing');
});

test('renaming a voice updates every meeting that uses it', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-rename-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const vector = embedding(3);
  await service.saveMeeting({ id: 'meeting-voice-2', title: '会议 A', transcript: 'A', voiceprints: { '发言人 1': vector } });
  const labelled = await service.labelVoice({ meetingId: 'meeting-voice-2', speaker: '发言人 1', name: '王五' });
  assert.equal(labelled.ok, true);
  const renamed = await service.renameVoice({ profileId: labelled.result.profiles[0].id, name: '赵六' });
  assert.equal(renamed.ok, true);
  const stored = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-voice-2.json'), 'utf8'));
  assert.equal(stored.speakerLabels['发言人 1'], '赵六');
});

test('naming an auto-created voice updates its existing profile without a duplicate', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-correct-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const vector = embedding(4);
  await service.saveVoiceProfiles([{
    id: 'voice-auto', name: '', embedding: vector, exemplars: [vector], createdAt: '', updatedAt: '',
  }]);
  await service.saveMeeting({
    id: 'meeting-voice-correct', title: '修正标注', transcript: '逐字稿',
    segments: [{ start: 0, end: 2, text: '逐字稿', speaker: '发言人 1' }],
    voiceprints: { '发言人 1': vector },
    speakerLabels: {},
    speakerProfiles: { '发言人 1': 'voice-auto' },
  });

  const corrected = await service.labelVoice({
    meetingId: 'meeting-voice-correct', speaker: '发言人 1', name: '修正后的名字',
  });
  assert.equal(corrected.ok, true);
  assert.equal(corrected.result.speakerProfiles['发言人 1'], 'voice-auto');
  const profiles = await service.loadVoiceProfiles();
  assert.equal(profiles.length, 1, 'correction must not create a second voice profile');
  assert.equal(profiles[0].id, 'voice-auto');
  assert.equal(profiles[0].name, '修正后的名字');
  const later = await service.resolveVoiceLabels({ 'Speaker 1': vector });
  assert.equal(later.labels['Speaker 1'], '修正后的名字');
});

test('voice profiles have permanent backups and recover from a damaged primary file', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-backup-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const vector = embedding(5);
  await service.saveVoiceProfiles([{
    id: 'voice-backed-up', name: '永久声音', embedding: vector, exemplars: [vector], createdAt: '', updatedAt: '',
  }]);

  const backupDir = join(dataDir, 'voices', 'backups');
  const backups = (await readdir(backupDir)).filter((name) => /^profiles-.*\.json$/.test(name));
  assert.equal(backups.length, 1, 'each saved voice-library state has an independent backup');
  const backup = JSON.parse(await readFile(join(backupDir, backups[0]), 'utf8'));
  assert.equal(backup.profiles[0].name, '永久声音');

  await writeFile(join(dataDir, 'voices', 'profiles.json'), '{damaged', 'utf8');
  const recovered = await service.loadVoiceProfiles();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, 'voice-backed-up');
  assert.equal(recovered[0].name, '永久声音');
});

test('a pre-existing voice library is backed up on its first read', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-migrate-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const voicesDir = join(dataDir, 'voices');
  await mkdir(voicesDir, { recursive: true });
  const vector = embedding(6);
  await writeFile(join(voicesDir, 'profiles.json'), JSON.stringify({
    profiles: [{ id: 'voice-legacy', name: '旧库声音', embedding: vector, exemplars: [vector] }],
  }), 'utf8');
  const service = createService();
  service.config.dataDir = dataDir;

  const profiles = await service.loadVoiceProfiles();
  assert.equal(profiles[0].name, '旧库声音');
  const backupDir = join(voicesDir, 'backups');
  const backups = await readdir(backupDir);
  assert.equal(backups.length, 1, 'the legacy primary file is migrated with a backup');
  const backup = JSON.parse(await readFile(join(backupDir, backups[0]), 'utf8'));
  assert.equal(backup.profiles[0].id, 'voice-legacy');

  await service.loadVoiceProfiles();
  assert.equal((await readdir(backupDir)).length, 1, 'later reads do not duplicate the migration backup');
});

test('correcting a false auto-match reassigns the speaker without rewriting the original person', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-reassign-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const alicePrint = [1, 0];
  const bobPrint = [0.9, 0.1];
  await service.saveVoiceProfiles([{
    id: 'voice-alice', name: 'Alice', embedding: alicePrint, exemplars: [alicePrint], createdAt: '', updatedAt: '',
  }]);
  await service.saveMeeting({
    id: 'meeting-alice', title: 'Alice meeting', transcript: 'Alice',
    segments: [{ start: 0, end: 1, text: 'Alice', speaker: '发言人 1' }],
    voiceprints: { '发言人 1': alicePrint },
    speakerLabels: { '发言人 1': 'Alice' }, speakerProfiles: { '发言人 1': 'voice-alice' },
  });
  await service.saveMeeting({
    id: 'meeting-bob', title: 'Bob meeting', transcript: 'Bob',
    segments: [{ start: 0, end: 1, text: 'Bob', speaker: '发言人 1' }],
    voiceprints: { '发言人 1': bobPrint },
    speakerLabels: { '发言人 1': 'Alice' }, speakerProfiles: { '发言人 1': 'voice-alice' },
  });

  const corrected = await service.labelVoice({ meetingId: 'meeting-bob', speaker: '发言人 1', name: 'Bob' });
  assert.equal(corrected.ok, true);
  assert.notEqual(corrected.result.speakerProfiles['发言人 1'], 'voice-alice');
  const profiles = await service.loadVoiceProfiles();
  const alice = profiles.find((profile) => profile.id === 'voice-alice');
  assert.equal(alice.name, 'Alice', 'the original person keeps their name');
  assert.deepEqual(alice.embedding, alicePrint, 'the original person is not retrained with another voice');
  assert.ok(profiles.some((profile) => profile.id !== 'voice-alice' && profile.name === 'Bob'));
  const aliceMeeting = await service.readMeetingRecord('meeting-alice');
  assert.equal(aliceMeeting.speakerLabels['发言人 1'], 'Alice');
});

test('concurrent voice resolutions preserve every profile and its backup history', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-concurrent-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;

  await Promise.all([
    service.resolveVoiceLabels({ 'Speaker A': [1, 0] }),
    service.resolveVoiceLabels({ 'Speaker B': [0, 1] }),
  ]);
  const profiles = await service.loadVoiceProfiles();
  assert.equal(profiles.length, 2, 'neither concurrent writer overwrites the other profile');
  const names = (await readdir(join(dataDir, 'voices', 'backups'))).sort();
  assert.ok(names.length >= 2);
  const finalBackup = JSON.parse(await readFile(join(dataDir, 'voices', 'backups', names.at(-1)), 'utf8'));
  assert.equal(finalBackup.profiles.length, 2, 'the newest backup contains the complete library');
});

test('two speaker clusters cannot be assigned and blended into one profile', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-collision-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  const resolved = await service.resolveVoiceLabels({ 'Speaker A': [1, 0], 'Speaker B': [1, 0] });
  assert.notEqual(resolved.profiles['Speaker A'], resolved.profiles['Speaker B']);
  assert.equal(resolved.known.length, 2);
});

test('backup revisions recover the newest valid state even when the latest snapshot is damaged', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-revisions-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  for (const name of ['state-1', 'state-2', 'state-3']) {
    await service.saveVoiceProfiles([{ id: 'voice-revision', name, embedding: [1], exemplars: [[1]] }]);
  }
  const backupDir = join(dataDir, 'voices', 'backups');
  const names = (await readdir(backupDir)).sort();
  assert.equal(names.length, 3);
  assert.ok(names.every((name) => /^profiles-\d{12}-/.test(name)), 'backups have a monotonic revision');
  await writeFile(join(backupDir, names.at(-1)), '{damaged newest', 'utf8');
  await writeFile(join(dataDir, 'voices', 'profiles.json'), '{damaged primary', 'utf8');
  const recovered = await service.loadVoiceProfiles();
  assert.equal(recovered[0].name, 'state-2');
});

test('a speaker without a voiceprint cannot be presented as a globally recognised voice', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-missing-print-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createService();
  service.config.dataDir = dataDir;
  await service.saveMeeting({
    id: 'meeting-no-print', title: 'No voiceprint', transcript: 'text',
    segments: [{ start: 0, end: 1, text: 'text', speaker: 'Speaker A' }],
  });
  const labelled = await service.labelVoice({ meetingId: 'meeting-no-print', speaker: 'Speaker A', name: 'Alice' });
  assert.equal(labelled.ok, false);
  assert.equal(labelled.error.code, 'minutes/voiceprint-missing');
  assert.equal((await service.loadVoiceProfiles()).length, 0);
});
