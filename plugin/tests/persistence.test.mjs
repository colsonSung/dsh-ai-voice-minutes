import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

function fakeLiveManager() {
  return {
    _session: { id: 'realtime-test-1', status: 'recording' },
    async stop() { this._session.status = 'stopped'; },
    async status() {
      return {
        session: {
          id: 'realtime-test-1', status: 'stopped', startedAt: '2026-10-28T09:28:26.713Z',
          endedAt: '2026-10-28T09:40:36.970Z', durationSeconds: 730, metrics: { audioBytes: 4096 },
        },
        events: [
          { seq: 1, type: 'transcript', source: 'mic', chunkId: 1, timestamp: 1000, text: '实时会议逐字稿内容' },
          { seq: 2, type: 'translation', source: 'mic', chunkId: 1, timestamp: 1000, text: 'live transcript', translation: 'Realtime transcript' },
        ],
      };
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for ' + message);
}

test('ending a live meeting persists the transcript as a stored meeting record', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-persist-live-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  }, {
    liveManager: fakeLiveManager(),
    desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {} },
  });
  service.config.dataDir = dataDir;
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'live-stop', payload: { id: 'realtime-test-1' } }),
  }));
  const body = await response.json();
  assert.equal(body.ok, true);
  // Saving happens after the route has answered, so wait for the record the
  // same way the meeting page does.
  await waitFor(async () => {
    const status = await route.fetch(new Request('http://localhost' + ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'live-stop-status', payload: { id: 'realtime-test-1' } }),
    })).then((res) => res.json());
    return status.ok && status.result.saved === true && status.result.pending === false;
  }, 'the meeting record to be written');
  const stored = JSON.parse(await readFile(join(dataDir, 'meetings', 'realtime-test-1.json'), 'utf8'));
  assert.ok(stored.transcript.includes('实时会议逐字稿内容'));
  assert.equal(stored.duration, 730);
  assert.equal(stored.realtime, true);
});

test('saving a meeting keeps transcript, segments and minutes on disk', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-persist-save-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = (() => {
    let value;
    apply({
      provide(name, item) { if (name === 'minutes') value = item; },
      inject(dependencies, callback) {
        if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
        if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
      },
    });
    return value;
  })();
  service.config.dataDir = dataDir;
  const saved = await service.saveMeeting({
    id: 'meeting-persist-1', title: '持久化会议',
    transcript: '逐字稿正文', segments: [{ start: 0, end: 1, text: '逐字稿正文', speaker: 'mic' }],
    minutes: { summary: '纪要摘要', topics: [{ title: '议题', summary: '内容' }] },
  });
  assert.equal(saved.ok, true);
  const onDisk = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-persist-1.json'), 'utf8'));
  assert.equal(onDisk.transcript, '逐字稿正文');
  assert.equal(onDisk.segments.length, 1);
  assert.equal(onDisk.minutes.summary, '纪要摘要');
  const loaded = await service.getMeeting('meeting-persist-1');
  assert.equal(loaded.result.meeting.minutes.topics[0].title, '议题');
});

test('history answers are persisted to the assistant history file', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-persist-assistant-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const requests = [];
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '历史回答' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const service = (() => {
    let value;
    apply({
      provide(name, item) { if (name === 'minutes') value = item; },
      inject(dependencies, callback) {
        if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
        if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
      },
    });
    return value;
  })();
  service.config.dataDir = dataDir;
  service.liveManager = null;
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  await mkdir(join(dataDir, 'meetings'), { recursive: true });
  await writeFile(join(dataDir, 'meetings', 'meeting-p.json'), JSON.stringify({
    id: 'meeting-p', title: '历史会议', createdAt: '2026-10-20T02:00:00Z',
    transcript: '历史会议逐字稿内容', minutes: { summary: '历史纪要摘要' },
  }), 'utf8');
  const result = await service.askHistory('有哪些待办？', { scope: 'all' });
  assert.equal(result.ok, true);
  const historyPath = join(dataDir, 'assistant', 'history.json');
  assert.ok(existsSync(historyPath), 'assistant history is persisted');
  const history = JSON.parse(await readFile(historyPath, 'utf8'));
  assert.equal(history.length, 1);
  assert.equal(history[0].question, '有哪些待办？');
  assert.equal(history[0].answer, '历史回答');
});
