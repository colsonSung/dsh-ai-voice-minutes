import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

function captureWithManager(liveManager, dataDir = '') {
  const routes = new Map();
  const effects = [];
  let service;
  const trackEffect = (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') effects.push(dispose);
    return dispose;
  };
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    effect: trackEffect,
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: trackEffect });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: trackEffect,
        });
      }
    },
  }, {
    liveManager,
    desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {} },
  });
  if (dataDir && service) service.config.dataDir = dataDir;
  const route = routes.get(ROUTE);
  route.effects = effects;
  return route;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for ' + message);
}

async function invoke(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }),
  }));
  return response.json();
}

test('live API starts, reads, and stops a realtime session', async (t) => {
  const calls = [];
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-live-host-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const session = { id: 'live-1', status: 'recording', startedAt: new Date().toISOString(), metrics: {} };
  const route = captureWithManager({
    async start(options) { calls.push(['start', options]); return session; },
    async status(id, after) { calls.push(['status', id, after]); return { session, events: [{ seq: 2, type: 'transcript', text: 'hello' }] }; },
    async stop(id) { calls.push(['stop', id]); return { ...session, status: 'stopped' }; },
    async pauseTranscription(id) { calls.push(['pause', id]); return { ...session, transcriptionPaused: true }; },
    async resumeTranscription(id) { calls.push(['resume', id]); return { ...session, transcriptionPaused: false }; },
  }, dataDir);

  const started = await invoke(route, 'live-start', { sourceLanguage: 'zh', targetLanguage: 'en' });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.id, 'live-1');
  const status = await invoke(route, 'live-status', { id: 'live-1', after: 1 });
  assert.equal(status.ok, true);
  assert.equal(status.result.events[0].text, 'hello');
  const paused = await invoke(route, 'live-pause', { id: 'live-1' });
  assert.equal(paused.ok, true);
  assert.equal(paused.result.session.transcriptionPaused, true);
  const resumed = await invoke(route, 'live-resume', { id: 'live-1' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.result.session.transcriptionPaused, false);

  const stopped = await invoke(route, 'live-stop', { id: 'live-1' });
  assert.equal(stopped.ok, true);
  // The route answers before the capture has finished draining, so the page can
  // move on while the meeting is saved behind it.
  assert.equal(stopped.result.session.status, 'stopping');
  assert.equal(stopped.result.meeting.id, 'live-1');
  assert.equal(stopped.result.meeting.inProgress, true);
  await waitFor(async () => {
    const body = await invoke(route, 'live-stop-status', { id: 'live-1' });
    return body.ok && body.result.pending === false;
  }, 'the background stop to finish');
  assert.equal(calls.some((call) => call[0] === 'stop' && call[1] === 'live-1'), true, 'the capture is still stopped');
  assert.equal(calls[1][2], 1);
});

test('plugin disposal stops an active realtime capture', async () => {
  const calls = [];
  const manager = {
    _session: { id: 'live-cleanup', status: 'recording' },
    async stop(id) { calls.push(id); return { id, status: 'stopped' }; },
  };
  const route = captureWithManager(manager);
  for (const dispose of route.effects) await dispose();
  assert.deepEqual(calls, ['live-cleanup']);
});

test('the overlay level channel works and never touches an undefined event', async (t) => {
  const sent = [];
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-level-host-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
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
  }, {
    desktopOverlay: {
      start: async () => {},
      stop: async () => {},
      send: async (event) => { sent.push(event); },
    },
  });
  service.config.dataDir = dataDir;

  const manager = service.liveManager;
  assert.equal(typeof manager.onLevel, 'function', 'the live manager keeps the level callback');
  // The level arrives many times a second while someone is speaking.
  await manager.onLevel({ source: 'mic', level: 0.42 });
  await manager.onLevel({ source: 'system', level: 0.1 });
  const levels = sent.filter((event) => event.type === 'level');
  assert.equal(levels.length, 2, 'both levels reach the overlay');
  assert.deepEqual(levels[0], { type: 'level', level: 0.42, source: 'mic' });
});
