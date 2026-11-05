import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';
import { RealtimeManager } from '../realtime.js';

function fakeCapture() {
  const stdout = new Readable({ read() {} });
  return {
    stdout,
    push(value) { stdout.push(value); },
    async stop() { this.push(JSON.stringify({ type: 'done' }) + '\n'); stdout.push(null); },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for ' + message);
}

async function fixture(t, text) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-overlay-stop-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const sent = [];
  let stopped = 0;
  let route;
  let service;
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    startCapture: async () => fakeCapture(),
    transcribe: async () => ({ text }),
    translate: async (value) => value,
  });
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  }, {
    liveManager: manager,
    desktopOverlay: {
      start: async () => {},
      stop: async () => { stopped += 1; },
      send: async (event) => { sent.push(event); },
    },
  });
  service.config.dataDir = dataDir;
  service.realtimeTrackSeconds = async () => 0;
  service.labelLiveSpeakers = async (meeting) => meeting;
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  manager._capture.push(JSON.stringify({
    type: 'audio', source: 'mic', timestamp: 0, sampleRate: 16000, channels: 1,
    pcmBase64: Buffer.alloc(320, 1).toString('base64'),
  }) + '\n');
  await waitFor(async () => (await manager.status(session.id, 0)).events.some((event) => event.type === 'transcript'), 'a transcript before stopping');
  return {
    manager, route, service, sent, session,
    stopCalls: () => stopped,
    async stop() {
      const response = await route.fetch(new Request('http://localhost' + ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'live-stop', payload: { id: session.id } }),
      }));
      return response.json();
    },
    /** The stop returns at once; this waits for the background finish. */
    async settled() {
      await waitFor(async () => {
        const response = await route.fetch(new Request('http://localhost' + ROUTE, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'live-stop-status', payload: { id: session.id } }),
        }));
        const body = await response.json();
        return body.ok && body.result.pending === false && body.result.saved === true;
      }, 'the stopped meeting to be written');
    },
  };
}

test('stopping closes the overlay at once instead of narrating the save', async (t) => {
  const { stop, settled, sent, stopCalls } = await fixture(t, '一句很短的话。');
  const body = await stop();
  assert.equal(body.ok, true, JSON.stringify(body.error || {}));
  // Ending a meeting must never make the floating window linger: it is a
  // caption window, not a progress dialog.
  await waitFor(() => stopCalls() === 1, 'the overlay to close');
  await settled();
  assert.equal(sent.some((event) => event.type === 'notice'), false, 'the window is not used to narrate the save');
  assert.equal(sent.some((event) => event.type === 'state' && event.stopping === true), false, 'no stopping state is pushed to a window that is closing');
});

test('the minutes are generated without the floating window', async (t) => {
  const { manager, service, stop, settled, sent, stopCalls } = await fixture(t, '这是一段用于生成会议纪要的完整内容。'.repeat(20));
  manager._session.startedAt = new Date(Date.now() - 61000).toISOString();
  let summarized = '';
  service.summarize = async (transcript) => {
    summarized = transcript;
    return { ok: true, result: { minutes: { summary: 'ready' } } };
  };
  const body = await stop();
  assert.equal(body.ok, true, JSON.stringify(body.error || {}));
  await waitFor(() => summarized.length > 0, 'the minutes are generated in the background');
  await settled();
  await waitFor(() => stopCalls() === 1, 'the overlay to close');
  assert.equal(sent.some((event) => event.type === 'notice'), false, 'the finished minutes are not announced inside the closed window');
});
