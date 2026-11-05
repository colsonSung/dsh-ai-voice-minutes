import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

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
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-audio-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { routes, service } = capturePlugin();
  service.config.dataDir = dataDir;
  await service.readSettings();
  const route = routes.get(ROUTE);
  const call = async (method, payload = {}) => {
    const response = await route.fetch(new Request('http://localhost' + ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }),
    }));
    return response.json();
  };
  return { routes, service, dataDir, call };
}

async function writeMeeting(dataDir, id, record) {
  await mkdir(join(dataDir, 'meetings'), { recursive: true });
  await writeFile(join(dataDir, 'meetings', id + '.json'), JSON.stringify(record), 'utf8');
}

async function writeTrack(dataDir, id, track, bytes = '0123456789') {
  const directory = join(dataDir, 'realtime', id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, track + '.pcm'), bytes, 'utf8');
}

test('a live meeting lists the tracks it recorded', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live', segments: [] });
  await writeTrack(dataDir, id, 'mic');
  await writeTrack(dataDir, id, 'system');

  const body = await call('audio-list', { id });
  assert.equal(body.ok, true);
  assert.equal(body.result.files.length, 3);
  assert.deepEqual(body.result.files.map((file) => file.track), ['mix', 'mic', 'system']);
  assert.deepEqual(body.result.files.map((file) => file.kind), ['mix', 'track', 'track']);
  assert.match(body.result.files[0].url, /live-audio\?id=realtime-test-1&track=mix/);
  assert.match(body.result.files[0].downloadUrl, /track=mix&download=1/);
  assert.equal(body.result.files[0].size, 54);
  for (const file of body.result.files) {
    assert.match(file.downloadUrl, /track=mix&download=1/, 'the download is always the complete recording');
  }
});

test('an imported meeting lists the original recording', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'meeting-uploaded';
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await writeFile(join(dataDir, 'audio', 'audio-1.wav'), 'RIFFDATA');
  await writeMeeting(dataDir, id, { id, title: 'Uploaded', audioId: 'audio-1', transcript: 'hello' });

  const body = await call('audio-list', { id });
  assert.equal(body.result.files.length, 1);
  assert.equal(body.result.files[0].kind, 'upload');
  assert.equal(body.result.files[0].name, 'audio-1.wav');
  assert.equal(body.result.files[0].mime, 'audio/wav');
});

test('deleting an audio file keeps the transcript and the minutes', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live', transcript: 'keep me', minutes: { summary: 'keep me too' } });
  await writeTrack(dataDir, id, 'mic');
  await writeTrack(dataDir, id, 'system');

  const body = await call('audio-delete', { id, kind: 'track', track: 'system' });
  assert.equal(body.ok, true);
  assert.equal(body.result.files.length, 2);
  assert.deepEqual(body.result.files.map((file) => file.track), ['mix', 'mic']);
  assert.equal(existsSync(join(dataDir, 'realtime', id, 'system.pcm')), false, 'the track is gone');
  assert.equal(existsSync(join(dataDir, 'realtime', id, 'mic.pcm')), true, 'the other track stays');

  const record = JSON.parse(await readFile(join(dataDir, 'meetings', id + '.json'), 'utf8'));
  assert.equal(record.transcript, 'keep me');
  assert.deepEqual(record.minutes, { summary: 'keep me too' });
});

test('deleting the uploaded recording clears the audio id but keeps the meeting', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'meeting-uploaded';
  await mkdir(join(dataDir, 'audio'), { recursive: true });
  await writeFile(join(dataDir, 'audio', 'audio-1.wav'), 'RIFFDATA');
  await writeMeeting(dataDir, id, { id, title: 'Uploaded', audioId: 'audio-1', transcript: 'hello' });

  const body = await call('audio-delete', { id, kind: 'upload' });
  assert.equal(body.ok, true);
  assert.equal(body.result.files.length, 0);
  assert.equal(existsSync(join(dataDir, 'audio', 'audio-1.wav')), false, 'the file is gone');

  const record = JSON.parse(await readFile(join(dataDir, 'meetings', id + '.json'), 'utf8'));
  assert.equal(record.audioId, '');
  assert.equal(record.transcript, 'hello');
});

test('deleting the complete recording removes both tracks and keeps the meeting', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live', transcript: 'keep me', minutes: { summary: 'keep me too' } });
  await writeTrack(dataDir, id, 'mic');
  await writeTrack(dataDir, id, 'system');

  const body = await call('audio-delete', { id, kind: 'mix' });
  assert.equal(body.ok, true, JSON.stringify(body.error || {}));
  assert.equal(body.result.files.length, 0, 'no recording is left to play');
  assert.equal(existsSync(join(dataDir, 'realtime', id, 'mic.pcm')), false, 'the mic track is gone');
  assert.equal(existsSync(join(dataDir, 'realtime', id, 'system.pcm')), false, 'the system track is gone');

  const record = JSON.parse(await readFile(join(dataDir, 'meetings', id + '.json'), 'utf8'));
  assert.equal(record.transcript, 'keep me');
  assert.deepEqual(record.minutes, { summary: 'keep me too' });
});

test('deleting an audio file that is not there fails instead of pretending', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live', transcript: 'hello' });

  const body = await call('audio-delete', { id, kind: 'track', track: 'mic' });
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'minutes/audio-missing');

  const unknown = await call('audio-delete', { id, kind: 'nonsense' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'minutes/audio-kind');
});

test('saving a meeting gives the voice book a playable excerpt', async (t) => {
  const { call, dataDir } = await fixture(t);
  const id = 'realtime-voice-1';
  await writeTrack(dataDir, id, 'mic');
  const saved = await call('save', {
    meeting: {
      id,
      title: 'Voice meeting',
      transcript: 'hello',
      voiceprints: { '发言人 1': [0.1, 0.2, 0.3] },
      segments: [{
        start: 35951.945, end: 35951.945, text: 'hello', speaker: '发言人 1',
        source: 'mic', audioStart: 5.2, audioEnd: 9.9,
      }],
    },
  });
  assert.equal(saved.ok, true);

  const voices = await call('voices');
  const profile = voices.result.profiles[0];
  assert.ok(profile, 'the voice is in the voice book');
  assert.ok(profile.sample, 'the voice carries a playable excerpt');
  assert.equal(profile.sample.meetingId, id);
  assert.equal(profile.sample.track, 'mic');
  assert.equal(profile.sample.start, 5.2);
  assert.equal(profile.sample.end, 9.9);
});

test('the complete audio is a real mix of the two tracks', async (t) => {
  const { routes, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live' });
  const mic = Buffer.from([100, 0, 200, 0, 50, 0]);
  const system = Buffer.from([200, 0, 100, 0]);
  await writeTrack(dataDir, id, 'mic', mic);
  await writeTrack(dataDir, id, 'system', system);

  const route = routes.get('/api/ai-minutes/live-audio');
  const url = `http://localhost/api/ai-minutes/live-audio?id=${id}&track=mix`;
  const full = await route.fetch(new Request(url));
  assert.equal(full.status, 200);
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.length, mic.length + 44);
  assert.deepEqual(
    [bytes.readInt16LE(44), bytes.readInt16LE(46), bytes.readInt16LE(48)],
    [150, 150, 25],
    'the two tracks are averaged sample by sample'
  );

  const part = await route.fetch(new Request(url, { headers: { range: 'bytes=44-49' } }));
  assert.equal(part.status, 206);
  assert.equal(Buffer.from(await part.arrayBuffer()).toString('hex'), bytes.subarray(44, 50).toString('hex'));

  const download = await route.fetch(new Request(url + '&download=1'));
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="meeting.wav"');
});

test('the complete download also works when only one track exists', async (t) => {
  const { routes, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live' });
  const mic = Buffer.from([100, 0, 200, 0]);
  await writeTrack(dataDir, id, 'mic', mic);
  // There is deliberately no system.pcm on disk.
  const route = routes.get('/api/ai-minutes/live-audio');
  const response = await route.fetch(new Request(`http://localhost/api/ai-minutes/live-audio?id=${id}&track=mix&download=1`));
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes.subarray(44), mic);
});

test('the download link saves the file instead of playing it', async (t) => {
  const { routes, dataDir } = await fixture(t);
  const id = 'realtime-test-1';
  await writeMeeting(dataDir, id, { id, title: 'Live' });
  await writeTrack(dataDir, id, 'mic');
  const route = routes.get('/api/ai-minutes/live-audio');

  const inline = await route.fetch(new Request(`http://localhost/api/ai-minutes/live-audio?id=${id}&track=mic`));
  assert.equal(inline.headers.get('content-disposition'), null);

  const saved = await route.fetch(new Request(`http://localhost/api/ai-minutes/live-audio?id=${id}&track=mic&download=1`));
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('content-disposition'), 'attachment; filename="mic.wav"');
});
