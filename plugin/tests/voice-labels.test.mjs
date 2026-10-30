import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  t.after(() => rm(dataDir, { recursive: true, force: true }));
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
  t.after(() => rm(dataDir, { recursive: true, force: true }));
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

test('renaming a voice updates every meeting that uses it', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-rename-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
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
