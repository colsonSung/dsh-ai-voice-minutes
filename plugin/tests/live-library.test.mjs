import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

test('stopped realtime sessions are listed and opened in the meeting library', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-live-library-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const id = 'realtime-library-1';
  await mkdir(join(dataDir, 'realtime', id), { recursive: true });
  await writeFile(join(dataDir, 'realtime', id, 'checkpoint.json'), JSON.stringify({
    id, status: 'stopped', startedAt: '2026-10-28T07:00:00Z', endedAt: '2026-10-28T07:00:20Z',
    durationSeconds: 20, degraded: false, metrics: {},
  }));
  await writeFile(join(dataDir, 'realtime', id, 'events.jsonl'), [
    { seq: 1, type: 'status', detail: 'recording' },
    { seq: 2, type: 'transcript', source: 'mic', chunkId: 1, timestamp: 1000, text: 'Hello from the live session' },
    { seq: 3, type: 'translation', source: 'mic', chunkId: 1, timestamp: 1500, text: '你好，实时会议', translation: '你好，实时会议', transcript: 'Hello from the live session' },
    { seq: 4, type: 'status', detail: 'stopped' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n');

  const routes = new Map();
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    effect: (fn) => fn(),
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  }, { dataDir });
  service.config.dataDir = dataDir;
  const route = routes.get(ROUTE);
  const invoke = async (method, payload = {}) => {
    const response = await route.fetch(new Request('http://localhost' + ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }),
    }));
    return response.json();
  };

  const list = await invoke('list');
  assert.equal(list.ok, true);
  const item = list.result.meetings.find((meeting) => meeting.id === id);
  assert.ok(item, 'realtime session appears in the library');
  assert.equal(item.liveStatus, 'stopped');
  assert.ok(item.transcriptLength > 0);

  const opened = await invoke('get', { id });
  assert.equal(opened.ok, true);
  assert.equal(opened.result.meeting.id, id);
  assert.match(opened.result.meeting.transcript, /Hello from the live session/);
  assert.equal(opened.result.meeting.segments[0].translation, '你好，实时会议');
});
