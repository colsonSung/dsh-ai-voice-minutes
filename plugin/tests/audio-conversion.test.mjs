import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import * as plugin from '../index.js';

const run = promisify(execFile);

test('compressed meeting audio becomes 16 kHz mono WAV for whisper.cpp', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-voice-minutes-audio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'sample.m4a');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2',
    '-c:a', 'aac', input,
  ]);

  assert.equal(typeof plugin.convertAudioToWav, 'function');
  const converted = await plugin.convertAudioToWav(await readFile(input), 'sample.m4a');
  assert.match(converted.filename, /\.wav$/i);
  assert.equal(converted.bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(converted.bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(converted.bytes.readUInt16LE(22), 1);
  assert.equal(converted.bytes.readUInt32LE(24), 16000);
});
