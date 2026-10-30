import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

const LIVE_AUDIO_ROUTE = '/api/ai-minutes/live-audio';

test('live audio endpoint streams a valid WAV for the requested track', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-live-audio-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const sessionId = 'realtime-test-1';
  await mkdir(join(dataDir, 'realtime', sessionId), { recursive: true });
  const pcm = Buffer.from([1, 0, 255, 127, 0, 128]);
  await writeFile(join(dataDir, 'realtime', sessionId, 'mic.pcm'), pcm);

  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { if (definition.path === LIVE_AUDIO_ROUTE) route = definition; return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  });
  service.config.dataDir = dataDir;
  assert.ok(route, 'live audio route is registered');
  const response = await route.fetch(new Request(`http://localhost${LIVE_AUDIO_ROUTE}?id=${sessionId}&track=mic`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('content-length'), String(pcm.length + 44));
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.length, pcm.length + 44);
  assert.ok(bytes.subarray(44).equals(pcm));
});
