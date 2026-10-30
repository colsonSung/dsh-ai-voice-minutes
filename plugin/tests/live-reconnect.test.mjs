import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

function applyWith(routeRef, options = {}) {
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) routeRef.route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  }, {
    desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {}, isOpen: () => options.overlayOpen === true },
    ...options,
  });
  return service;
}

async function call(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  }));
  return response.json();
}

test('live-active returns the session that is still recording', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-active-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const routeRef = {};
  const session = { id: 'realtime-live-1', status: 'recording', startedAt: '2026-10-29T08:00:00.000Z', metrics: {}, transcriptionPaused: false };
  const service = applyWith(routeRef, {
    liveManager: {
      _session: session,
      async status() { return { session, events: [{ seq: 1, type: 'transcript', text: 'hi', source: 'mic' }] }; },
    },
  });
  service.config.dataDir = dataDir;
  const body = await call(routeRef.route, 'live-active');
  assert.equal(body.ok, true);
  assert.equal(body.result.session.id, 'realtime-live-1');
  assert.equal(body.result.events.length, 1);
});

test('the overlay status reflects whether the floating window is open', async () => {
  const routeRef = {};
  applyWith(routeRef, { overlayOpen: true });
  const body = await call(routeRef.route, 'live-overlay-status');
  assert.equal(body.ok, true);
  assert.equal(body.result.open, true);
});

test('saved meetings carry a simplified transcript when the source is traditional', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-t2s-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = applyWith({});
  service.config.dataDir = dataDir;
  const saved = await service.saveMeeting({
    id: 'meeting-t2s-1', title: '繁体会议',
    transcript: '這個東西甚麼字幕響鐘',
    segments: [{ start: 0, end: 1, text: '這個東西', speaker: 'mic' }],
  });
  assert.equal(saved.ok, true);
  const onDisk = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-t2s-1.json'), 'utf8'));
  assert.equal(onDisk.transcriptSimplified, '这个东西什么字幕响钟');
  assert.equal(onDisk.segments[0].textSimplified, '这个东西');
});

test('a partial save never wipes stored segments or minutes', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-merge-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = applyWith({});
  service.config.dataDir = dataDir;
  await service.saveMeeting({
    id: 'meeting-merge-1', title: '合并保护', transcript: '逐字稿',
    segments: [{ start: 0, end: 2, text: '逐字稿', speaker: 'mic' }],
    minutes: { summary: '已有纪要' },
  });
  await service.saveMeeting({ id: 'meeting-merge-1', title: '合并保护', transcript: '逐字稿', segments: [] });
  const record = await service.readMeetingRecord('meeting-merge-1');
  assert.equal(record.segments.length, 1, 'segments survive a partial save');
  assert.equal(record.minutes.summary, '已有纪要', 'minutes survive a partial save');
});

test('a labelled voice keeps a playable sample and can be deleted', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-voice-sample-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = applyWith({});
  service.config.dataDir = dataDir;
  await service.saveMeeting({
    id: 'meeting-voice-9', title: '声音样本', transcript: '甲说了一句话，乙回应。',
    segments: [{ start: 3, end: 6, text: '甲说了一句话', speaker: '发言人 1' }],
    voiceprints: { '发言人 1': [0.1, 0.2, 0.3] },
  });
  const labelled = await service.labelVoice({ meetingId: 'meeting-voice-9', speaker: '发言人 1', name: '甲' });
  assert.equal(labelled.ok, true);
  const profiles = await service.loadVoiceProfiles();
  const profile = profiles[0];
  assert.ok(profile.sample, 'the profile keeps a sample range');
  assert.equal(profile.sample.meetingId, 'meeting-voice-9');
  assert.equal(profile.sample.start, 3);
  assert.equal(profile.sample.end, 6);

  const removed = await service.deleteVoice({ profileId: profile.id });
  assert.equal(removed.ok, true);
  assert.equal((await service.loadVoiceProfiles()).length, 0);
});

test('live-summary produces progressive minutes from the transcript so far', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"进行中","topics":[{"title":"议题"}],"chapters":[],"decisions":[],"todos":[],"viewpoints":[]}' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-live-summary-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const routeRef = {};
  const session = { id: 'realtime-live-2', status: 'recording', startedAt: '2026-10-29T08:00:00.000Z', metrics: {} };
  const service = applyWith(routeRef, {
    liveManager: {
      _session: session,
      async status() {
        return {
          session,
          events: [
            { seq: 1, type: 'transcript', source: 'mic', text: '我们讨论开票时机与退款流程，确认先开票再支付，并且需要把冲销与逆向流程一并纳入评审范围，避免上线后返工。' },
            { seq: 2, type: 'transcript', source: 'system', text: '同时需要确认对账口径和截止时间，以及渠道侧的结算周期是否会影响本次迭代的验收标准。' },
          ],
        };
      },
    },
  });
  service.config.dataDir = dataDir;
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  const body = await call(routeRef.route, 'live-summary', { id: 'realtime-live-2' });
  assert.equal(body.ok, true);
  assert.equal(body.result.summary.summary, '进行中');
  assert.ok(requests.length >= 1, 'the model was asked for an interim summary');
});
