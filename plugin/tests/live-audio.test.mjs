import assert from 'node:assert/strict';
import test from 'node:test';
import * as plugin from '../index.js';

test('live PCM chunks receive a valid mono 16 kHz WAV header', () => {
  assert.equal(typeof plugin.pcmToWav, 'function');
  const pcm = Buffer.from([1, 0, 255, 127, 0, 128]);
  const wav = plugin.pcmToWav(pcm, 16000, 1);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), pcm.length + 36);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.ok(wav.subarray(44).equals(pcm));
});

test('native frames aggregate into bounded five-second track chunks', async () => {
  assert.equal(typeof plugin.createCaptureStream, 'function');
  const frame = Buffer.alloc(320, 1);
  const input = (async function * () {
    for (let index = 0; index < 10; index += 1) {
      yield JSON.stringify({ type: 'audio', source: 'mic', timestamp: index * 10, sampleRate: 16000, channels: 1, pcmBase64: frame.toString('base64') }) + '\n';
    }
    yield JSON.stringify({ type: 'done' }) + '\n';
  })();
  const events = [];
  for await (const chunk of plugin.createCaptureStream(input, { chunkMs: 50 })) {
    events.push(JSON.parse(String(chunk)));
  }
  // The stream also reports the live level while it builds the chunks.
  const audio = events.filter((event) => event.type === 'audio');
  assert.equal(audio.length, 2);
  assert.equal(audio[0].timestamp, 0);
  assert.equal(audio[1].timestamp, 50);
  assert.equal(Buffer.from(audio[0].pcmBase64, 'base64').length, 1600);
  assert.equal(Buffer.from(audio[1].pcmBase64, 'base64').length, 1600);
  assert.equal(events.at(-1).type, 'done');
  assert.ok(events.some((event) => event.type === 'level'), 'the live level travels with the audio');
});
