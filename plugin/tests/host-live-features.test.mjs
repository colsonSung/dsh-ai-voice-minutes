import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';
import { RealtimeManager } from '../realtime.js';

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

function fakeCapture() {
  const stdout = new Readable({ read() {} });
  return {
    stdout,
    push(value) { stdout.push(value); },
    async stop() { this.push(JSON.stringify({ type: 'done' }) + '\n'); stdout.push(null); },
  };
}

test('templates route exposes the built-in starting templates', async () => {
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  });
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'templates' }),
  }));
  const body = await response.json();
  assert.equal(body.ok, true);
  const ids = body.result.templates.map((item) => item.id);
  assert.deepEqual(ids, ['intelligent-slicing', 'visual-summary', 'classic', 'meeting-minutes']);
  assert.ok(body.result.templates[0].name.length > 0);
});

test('summarize shapes the prompt from the chosen template', async (t) => {
  const prompts = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      prompts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).messages.map((item) => item.content).join('\n'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"s","topics":[],"chapters":[],"decisions":[],"todos":[],"viewpoints":[]}' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-template-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  await service.summarize('一段会议内容', { title: 'T', template: 'meeting-minutes' });
  assert.ok(prompts[0].includes('会议纪要'), 'template instruction is applied');
  assert.ok(prompts[0].includes('一段会议内容'));
});

test('the library marks a running session as in progress', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-inprogress-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let route;
  let service;
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    startCapture: async () => fakeCapture(),
    transcribe: async () => ({ text: 'hello', segments: [] }),
    translate: async (text) => text,
  });
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  }, {
    liveManager: { dataDir, status: (id, after) => manager.status(id, after) },
    desktopOverlay: { start: async () => {}, stop: async () => {}, send: async () => {} },
  });
  service.config.dataDir = dataDir;
  await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'list' }),
  }));
  const body = await response.json();
  const live = body.result.meetings.find((meeting) => meeting.realtime);
  assert.ok(live, 'the running session is listed');
  assert.equal(live.inProgress, true);
  assert.equal(live.liveStatus, 'recording');
  await manager.stop();
});

test('an incognito session never writes into the meeting library', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-incognito-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    startCapture: async () => fakeCapture(),
    transcribe: async () => ({ text: 'hello', segments: [] }),
    translate: async (text) => text,
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en', incognito: true });
  assert.equal(session.incognito, true);
  assert.ok(!existsSync(join(dataDir, 'realtime', session.id)), 'nothing is written to the meeting data directory');
  await manager.stop();
});

test('markers are written into the session journal', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-marker-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    startCapture: async () => fakeCapture(),
    transcribe: async () => ({ text: 'hello', segments: [] }),
    translate: async (text) => text,
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  await manager.mark(session.id, { kind: 'flag', text: '重点' });
  await manager.stop();
  const raw = await readFile(join(dataDir, 'realtime', session.id, 'events.jsonl'), 'utf8');
  const events = raw.trim().split('\n').map((line) => JSON.parse(line));
  const marker = events.find((event) => event.type === 'marker');
  assert.ok(marker, 'the marker event is persisted');
  assert.equal(marker.kind, 'flag');
  assert.equal(marker.text, '重点');
});

test('a failing translation endpoint reports the host and retries', async (t) => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      request.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '你好' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-retry-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  service.config.translationBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.translationProvider = 'lmstudio';
  const result = await service.translate('hello', { targetLanguage: 'zh' });
  assert.equal(result.ok, true);
  assert.equal(result.result.translation, '你好');
  assert.ok(attempts >= 2, 'the request was retried');
});
