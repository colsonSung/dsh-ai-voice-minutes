import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

test('an interrupted session is recovered into a meeting record', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-recovery-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const sessionDir = join(dataDir, 'realtime', 'realtime-interrupted-1');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'checkpoint.json'), JSON.stringify({
    id: 'realtime-interrupted-1', status: 'stopped', startedAt: '2026-10-29T08:00:00.000Z',
    endedAt: '2026-10-29T08:20:00.000Z', durationSeconds: 1200, metrics: { audioBytes: 4096 },
  }), 'utf8');
  await writeFile(join(sessionDir, 'events.jsonl'), [
    JSON.stringify({ seq: 1, type: 'status', detail: 'recording', timestamp: '2026-10-29T08:00:00.000Z' }),
    JSON.stringify({ seq: 2, type: 'transcript', source: 'mic', chunkId: 1, timestamp: 1000, text: '中断前的逐字稿内容' }),
    JSON.stringify({ seq: 3, type: 'translation', source: 'mic', chunkId: 1, timestamp: 1000, text: 'x', translation: 'transcript before the restart' }),
    JSON.stringify({ seq: 4, type: 'status', detail: 'stopped', timestamp: '2026-10-29T08:20:00.000Z' }),
  ].join('\n') + '\n', 'utf8');

  const service = createService();
  service.config.dataDir = dataDir;
  const recovered = await service.recoverMeetings();
  assert.ok(recovered.recovered >= 1, 'the interrupted session was recovered');
  const record = join(dataDir, 'meetings', 'realtime-interrupted-1.json');
  assert.ok(existsSync(record), 'a meeting record was written');
  const parsed = JSON.parse(await (await import('node:fs/promises')).readFile(record, 'utf8'));
  assert.ok(parsed.transcript.includes('中断前的逐字稿内容'));
  assert.equal(parsed.duration, 1200);
  assert.equal(parsed.realtime, true);

  const again = await service.recoverMeetings();
  assert.equal(again.recovered, 0, 'recovery is idempotent');
});
