import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply } from '../index.js';

const MEETING_AUDIO_ROUTE = '/api/ai-minutes/meeting-audio';
const LIVE_AUDIO_ROUTE = '/api/ai-minutes/live-audio';

/**
 * Build the Request the way the Host connection bridge builds it: a route
 * without a body mode gets a Request that carries a body, which is illegal
 * for GET and throws before the route handler ever runs.
 */
function bridgeRequest(url, method, headers, requestBody) {
  if (requestBody === 'buffered') return new Request(url, { method, headers });
  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(Readable.from([])),
    duplex: 'half',
  });
}

function capturePlugin() {
  const routes = new Map();
  let service;
  apply({
    provide(name, value) {
      if (name === 'minutes') service = value;
    },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) {
        callback({ commands: { register: () => () => {} }, effect: (register) => register() });
      }
      if (dependencies.includes('connection')) {
        const ctx = {
          connection: {
            fetch: {
              register(definition) {
                routes.set(definition.path, definition);
                return () => {};
              },
            },
          },
        };
        ctx.effect = (register) => register();
        callback(ctx);
      }
    },
  });
  return { routes, service };
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-range-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { routes, service } = capturePlugin();
  service.config.dataDir = dataDir;
  await service.readSettings();
  return { routes, service, dataDir };
}

async function call(routes, path, headers = {}) {
  const route = routes.get(path);
  assert.ok(route, `${path} is registered`);
  const response = await route.fetch(new Request('http://localhost' + path + (path.includes('meeting-audio') ? '?id=audio-test-1' : '?id=realtime-test-1&track=mic'), { headers }));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

/** Serve a route the way the Host bridge serves it. */
async function callThroughBridge(routes, path, headers = {}) {
  const route = routes.get(path);
  const url = 'http://localhost' + path + (path.includes('meeting-audio') ? '?id=audio-test-1' : '?id=realtime-test-1&track=mic');
  const response = await route.fetch(bridgeRequest(url, 'GET', { host: '127.0.0.1:50610', ...headers }, route.requestBody));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

test('the audio routes survive the Host bridge, which refuses a GET with a body', async (t) => {
  const { routes, dataDir } = await fixture(t);
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await writeFile(join(dataDir, 'audio', 'audio-test-1.wav'), Buffer.from('RIFF____WAVEfmt !'));
  const sessionDir = join(dataDir, 'realtime', 'realtime-test-1');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'mic.pcm'), Buffer.from('0123456789'));

  for (const path of [MEETING_AUDIO_ROUTE, LIVE_AUDIO_ROUTE]) {
    const route = routes.get(path);
    assert.equal(route.requestBody, 'buffered', `${path} declares a body mode`);
    const served = await callThroughBridge(routes, path);
    assert.equal(served.status, 200, `${path} is served through the bridge`);
    assert.ok(served.body.length > 0, `${path} returns audio`);
  }
});

test('the meeting audio can be requested in parts so the browser can seek', async (t) => {
  const { routes, dataDir } = await fixture(t);
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  const bytes = Buffer.from('RIFF____WAVEfmt !');
  await writeFile(join(dataDir, 'audio', 'audio-test-1.wav'), bytes);

  const full = await call(routes, MEETING_AUDIO_ROUTE);
  assert.equal(full.status, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(full.body.length, bytes.length);
  assert.equal(full.headers['content-type'], 'audio/wav');

  const part = await call(routes, MEETING_AUDIO_ROUTE, { range: 'bytes=4-9' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], `bytes 4-9/${bytes.length}`);
  assert.equal(part.body.toString(), bytes.subarray(4, 10).toString());

  const open = await call(routes, MEETING_AUDIO_ROUTE, { range: 'bytes=8-' });
  assert.equal(open.status, 206);
  assert.equal(open.body.length, bytes.length - 8);

  const bad = await call(routes, MEETING_AUDIO_ROUTE, { range: 'bytes=999-1200' });
  assert.equal(bad.status, 416);
});

test('the live track keeps its WAV header when a range is requested', async (t) => {
  const { routes, dataDir } = await fixture(t);
  const sessionDir = join(dataDir, 'realtime', 'realtime-test-1');
  await mkdir(sessionDir, { recursive: true });
  const pcm = Buffer.from('0123456789abcdefghij');
  await writeFile(join(sessionDir, 'mic.pcm'), pcm);

  const full = await call(routes, LIVE_AUDIO_ROUTE);
  assert.equal(full.status, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(full.body.length, pcm.length + 44);
  assert.equal(full.body.subarray(0, 4).toString('ascii'), 'RIFF');

  // The first 44 bytes are the WAV header, so a range that starts there is the header.
  const header = await call(routes, LIVE_AUDIO_ROUTE, { range: 'bytes=0-43' });
  assert.equal(header.status, 206);
  assert.equal(header.body.length, 44);
  assert.equal(header.body.subarray(0, 4).toString('ascii'), 'RIFF');

  // A range past the header maps back onto the raw PCM.
  const pcmPart = await call(routes, LIVE_AUDIO_ROUTE, { range: 'bytes=44-53' });
  assert.equal(pcmPart.status, 206);
  assert.equal(pcmPart.body.toString(), pcm.subarray(0, 10).toString());

  const tail = await call(routes, LIVE_AUDIO_ROUTE, { range: 'bytes=54-63' });
  assert.equal(tail.status, 206);
  assert.equal(tail.body.toString(), pcm.subarray(10, 20).toString());
});
