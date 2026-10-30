import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';
import { liveMeetingFromStatus } from '../live.js';

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

test('library entries include excerpt, audio size, and creator', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-metadata-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await writeFile(join(dataDir, 'audio', 'audio-123.m4a'), Buffer.alloc(1234));
  const service = createService();
  service.config.dataDir = dataDir;
  const saved = await service.saveMeeting({
    id: 'meeting-1', title: 'Metadata', transcript: 'A transcript', audioId: 'audio-123',
    minutes: { summary: 'A concise meeting summary' },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.result.meeting.audioSize, 1234);
  const list = await service.listMeetings();
  const item = list.result.meetings[0];
  assert.equal(item.excerpt, 'A concise meeting summary');
  assert.equal(item.size, 1234);
  assert.equal(item.creator, userInfo().username);

  const live = liveMeetingFromStatus({
    session: { id: 'realtime-1', status: 'stopped', startedAt: '2026-10-28T07:00:00Z', durationSeconds: 5, metrics: { audioBytes: 4321 } },
    events: [{ seq: 1, type: 'transcript', source: 'mic', chunkId: 1, timestamp: 1000, text: 'Live excerpt' }],
  });
  assert.equal(live.excerpt, 'Live excerpt');
  assert.equal(live.size, 4321);
  assert.equal(live.creator, userInfo().username);
});
