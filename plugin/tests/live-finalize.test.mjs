import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
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

test('chunk transcripts are marked provisional and a final transcript can replace them', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-pass-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    startCapture: async () => fakeCapture(),
    transcribe: async () => ({ text: '临时字幕', segments: [] }),
    translate: async (text) => text,
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en', hotwords: '进件,KYC' });
  assert.equal(session.hotwords, '进件,KYC');
  const pcm = Buffer.alloc(1600);
  for (let index = 0; index < pcm.length; index += 2) pcm.writeInt16LE(index % 2 ? 6000 : -6000, index);
  manager._capture.push(JSON.stringify({ type: 'audio', source: 'mic', chunkId: 1, timestamp: 0, sampleRate: 16000, channels: 1, pcmBase64: pcm.toString('base64') }) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 800));
  await manager.applyFinalTranscript([
    { start: 0, end: 2, text: '最终字幕', speaker: 'mic' },
  ], { text: '最终字幕' });
  await manager.stop();
  const raw = await readFile(join(dataDir, 'realtime', session.id, 'events.jsonl'), 'utf8');
  const events = raw.trim().split('\n').map((line) => JSON.parse(line));
  const provisional = events.find((event) => event.type === 'transcript');
  assert.equal(provisional.pass, 'provisional', 'chunk transcripts are provisional');
  const final = events.find((event) => event.type === 'transcript-final');
  assert.ok(final, 'the final transcript event is persisted');
  assert.equal(final.text, '最终字幕');
  assert.equal(final.segments[0].speaker, 'mic');
});

test('the Host exposes live-finalize and live-summary-status', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-finalize-route-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  });
  service.config.dataDir = dataDir;
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'live-summary-status', payload: { id: 'realtime-x' } }),
  }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.pending, false);
  assert.equal(body.result.finalCount, 0);
});

test('finalizing a session posts the accumulated audio to the ASR service', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-finalize-call-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const sessionDir = join(dataDir, 'realtime', 'realtime-f-1');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'mic.pcm'), Buffer.alloc(3200, 7));
  await writeFile(join(sessionDir, 'system.pcm'), Buffer.alloc(1600, 3));

  const requests = [];
  const asr = await import('node:http');
  const server = asr.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ url: request.url, hasMic: body.includes('name="track"\r\n\r\nmic'), hasSystem: body.includes('name="track"\r\n\r\nsystem'), hotwords: body.includes('name="hotwords"') && body.includes('进件') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ text: '精修文本', segments: [{ start: 0, end: 1, text: '精修文本', speaker: 'mic' }], engine: 'funasr' }));
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
  service.config.asrBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  const result = await service.finalizeSession({ id: 'realtime-f-1', hotwords: '进件' }, {});
  assert.equal(result.ok, true);
  assert.equal(result.result.text, '精修文本');
  assert.equal(requests.length, 2, 'both tracks are finalized');
  assert.ok(requests.some((request) => request.hasMic));
  assert.ok(requests.some((request) => request.hasSystem));
  assert.ok(requests.some((request) => request.hotwords));
});
