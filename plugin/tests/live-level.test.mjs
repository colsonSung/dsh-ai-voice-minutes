import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createCaptureStream, createLiveManager } from '../live.js';

function frame(seconds, peak) {
  const samples = Math.round(16000 * seconds);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 8) * peak), index * 2);
  }
  return {
    type: 'audio', source: 'mic', timestamp: 0, sampleRate: 16000, channels: 1,
    pcmBase64: buffer.toString('base64'),
  };
}

/** The native capture sends thirty millisecond frames over time. */
function frameStream(count, delayMs, peak) {
  let index = 0;
  return new Readable({
    read() {
      if (index >= count) {
        this.push(null);
        return;
      }
      index += 1;
      // The frames arrive spread over time, so the level throttle sees real gaps.
      const line = JSON.stringify(frame(0.03, peak)) + '\n';
      if (delayMs > 0) setTimeout(() => this.push(line), delayMs);
      else this.push(line);
    },
  });
}

async function collect(stream) {
  const lines = [];
  for await (const line of stream) {
    const text = String(line).trim();
    if (text) lines.push(text);
  }
  return lines.map((line) => JSON.parse(line));
}

function base64Length(bytes) {
  return 4 * Math.ceil(bytes / 3);
}

test('the capture stream reports the live level while it builds the chunks', async () => {
  const events = await collect(createCaptureStream(frameStream(40, 25, 4000), { chunkMs: 10000 }));
  const levels = events.filter((event) => event.type === 'level');
  assert.ok(levels.length >= 5, `the level keeps coming, got ${levels.length}`);
  assert.ok(levels.every((event) => event.level > 0 && event.level <= 1), 'the level is a share of the full scale');
  assert.ok(levels.some((event) => event.level > 0.05), 'speech shows up as a level');
});

test('a quiet room reports a quiet level', async () => {
  const events = await collect(createCaptureStream(frameStream(5, 25, 10), { chunkMs: 10000 }));
  const levels = events.filter((event) => event.type === 'level');
  assert.ok(levels.length >= 1);
  assert.ok(levels[0].level < 0.05, 'silence is a small level');
});

test('the live manager keeps the level callback so the overlay can be fed', () => {
  const levels = [];
  const manager = createLiveManager({ config: { dataDir: '/tmp' } }, {
    onLevel: (value) => levels.push(value),
  });
  assert.equal(typeof manager.onLevel, 'function', 'the manager forwards the level');
  manager.onLevel({ source: 'mic', level: 0.5 });
  assert.deepEqual(levels, [{ source: 'mic', level: 0.5 }]);
});

test('the caption chunk length decides how soon the text appears', async () => {
  const ten = await collect(createCaptureStream(frameStream(400, 0, 3000), { chunkMs: 10000 }));
  const audio = ten.filter((event) => event.type === 'audio');
  assert.equal(audio.length, 2, 'twelve seconds of audio is one chunk plus the rest');
  assert.equal(audio[0].pcmBase64.length, base64Length(16000 * 2 * 10), 'the first chunk holds ten seconds');

  const five = await collect(createCaptureStream(frameStream(400, 0, 3000), { chunkMs: 5000 }));
  const shorter = five.filter((event) => event.type === 'audio');
  assert.equal(shorter.length, 3, 'twelve seconds of audio is two chunks plus the rest');
  assert.equal(shorter[0].pcmBase64.length, base64Length(16000 * 2 * 5), 'the first chunk holds five seconds');
});

test('louder speech gets a larger amplitude than quiet speech', async () => {
  const quiet = await collect(createCaptureStream(frameStream(3, 0, 500), { chunkMs: 10000 }));
  const loud = await collect(createCaptureStream(frameStream(3, 0, 6000), { chunkMs: 10000 }));
  const quietLevel = quiet.find((event) => event.type === 'level').level;
  const loudLevel = loud.find((event) => event.type === 'level').level;
  assert.ok(loudLevel > quietLevel * 2, `loud ${loudLevel} should dwarf quiet ${quietLevel}`);
  assert.ok(loudLevel > 0.5, 'loud speech really moves the waveform');
});
