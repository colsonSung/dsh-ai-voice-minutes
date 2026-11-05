import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

function captureWithManager(manager, dataDir) {
  const routes = new Map();
  let service = null;
  const effects = [];
  const track = (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') effects.push(dispose);
    return dispose;
  };
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    effect: track,
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: track });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: track,
        });
      }
    },
  }, {
    dataDir,
    autoStartLocalServices: false,
    liveManager: manager,
    desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {} },
  });
  return routes.get(ROUTE);
}

async function invoke(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }),
  }));
  return response.json();
}

/**
 * A manager whose stop takes a deliberately long time, so "did the route wait
 * for it" is measurable instead of a matter of timing luck.
 */
function slowManager({ stopDelayMs = 800, sessionSeconds = 730 } = {}) {
  const events = [
    { seq: 1, type: 'status', detail: 'recording', timestamp: 1000 },
    { seq: 2, type: 'transcript', source: 'mic', chunkId: 1, timestamp: 2000, text: '实时会议逐字稿内容' },
  ];
  let stopCalls = 0;
  return {
    _session: { id: 'realtime-slow-1', status: 'recording', startedAt: '2026-10-28T09:28:26.713Z' },
    get stopCalls() { return stopCalls; },
    async stop() {
      stopCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, stopDelayMs));
      this._session.status = 'stopped';
      return { id: 'realtime-slow-1', status: 'stopped' };
    },
    async status() {
      return {
        session: {
          id: 'realtime-slow-1', status: this._session.status,
          startedAt: '2026-10-28T09:28:26.713Z', endedAt: '2026-10-28T09:40:36.970Z',
          durationSeconds: sessionSeconds, metrics: { audioBytes: 4096 },
        },
        events,
      };
    },
  };
}

test('End meeting answers immediately and finishes in the background', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-stop-fast-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const manager = slowManager({ stopDelayMs: 800 });
  const route = captureWithManager(manager, dataDir);

  const started = Date.now();
  const stopped = await invoke(route, 'live-stop', { id: 'realtime-slow-1' });
  const elapsed = Date.now() - started;

  assert.equal(stopped.ok, true, JSON.stringify(stopped.error || {}));
  // The route must not wait for the capture drain, let alone the minutes.
  assert.ok(elapsed < 400, `End meeting answered in ${elapsed}ms; it must not wait for the stop`);
  assert.equal(stopped.result.session.status, 'stopping');
  assert.equal(stopped.result.meeting.inProgress, true, 'the page is told the record is still being written');

  // The record lands afterwards, without the reader doing anything.
  const deadline = Date.now() + 8000;
  let record = null;
  while (Date.now() < deadline) {
    record = await readFile(join(dataDir, 'meetings', 'realtime-slow-1.json'), 'utf8').catch(() => null);
    if (record) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(record, 'the meeting is saved in the background');
  const stored = JSON.parse(record);
  assert.match(stored.transcript, /实时会议逐字稿内容/);
  assert.equal(stored.realtime, true);
  assert.equal(manager.stopCalls, 1, 'the capture is stopped exactly once');
});

test('the stop is idempotent: pressing End meeting twice does not stop twice', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-stop-twice-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const manager = slowManager({ stopDelayMs: 200 });
  const route = captureWithManager(manager, dataDir);

  const first = await invoke(route, 'live-stop', { id: 'realtime-slow-1' });
  const second = await invoke(route, 'live-stop', { id: 'realtime-slow-1' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(manager.stopCalls, 1, 'a second press joins the stop in flight');
});

test('the page can ask whether the stop has finished', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-stop-status-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const manager = slowManager({ stopDelayMs: 300 });
  const route = captureWithManager(manager, dataDir);

  await invoke(route, 'live-stop', { id: 'realtime-slow-1' });
  const pending = await invoke(route, 'live-stop-status', { id: 'realtime-slow-1' });
  assert.equal(pending.ok, true);
  assert.equal(pending.result.pending, true, 'the stop is still running');

  const deadline = Date.now() + 8000;
  let settled = null;
  while (Date.now() < deadline) {
    settled = await invoke(route, 'live-stop-status', { id: 'realtime-slow-1' });
    if (settled.result.pending === false && settled.result.saved === true) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(settled.result.pending, false);
  assert.equal(settled.result.saved, true, 'the record exists once the stop is done');
  assert.match(settled.result.meeting.transcript, /实时会议逐字稿内容/);
});

test('the floating window closes at once instead of narrating the save', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-stop-overlay-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const closed = [];
  const sent = [];
  const manager = slowManager({ stopDelayMs: 400 });
  const routes = new Map();
  apply({
    provide() {},
    effect(fn) { fn(); return () => {}; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  }, {
    dataDir,
    autoStartLocalServices: false,
    liveManager: manager,
    desktopOverlay: {
      start: async () => {},
      stop: async () => { closed.push(Date.now()); },
      send: async (event) => { sent.push(event); },
    },
  });
  const route = routes.get(ROUTE);
  const opened = Date.now();
  await invoke(route, 'live-stop', { id: 'realtime-slow-1' });
  assert.equal(closed.length, 1, 'the window is closed');
  assert.ok(closed[0] - opened < 400, 'the window closes before the stop finishes');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(sent.some((event) => event.type === 'notice'), false, 'nothing is narrated inside the closed window');
  assert.equal(sent.some((event) => event.type === 'state' && event.stopping === true), false,
    'no stopping state is pushed to a window that is closing');
});
