import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RealtimeManager } from '../realtime.js';

test('pause suspends transcription while raw recording continues, then resume drains backlog', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-pause-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let transcribeCalls = 0;
  const manager = new RealtimeManager({
    dataDir,
    startCapture: async () => ({ stdout: (async function * () { await done; })(), stop: async () => finish() }),
    transcribe: async () => { transcribeCalls += 1; return 'text'; },
    translate: async () => 'translation',
    retryDelay: 0,
  });
  const { id } = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  await manager.pauseTranscription();
  const pcm = Buffer.alloc(32000, 1);
  await manager._acceptAudio({ type: 'audio', source: 'mic', timestamp: 1000, sampleRate: 16000, channels: 1, pcmBase64: pcm.toString('base64') });
  await manager._acceptAudio({ type: 'audio', source: 'mic', timestamp: 2000, sampleRate: 16000, channels: 1, pcmBase64: pcm.toString('base64') });
  const paused = await manager.status(id, 0);
  assert.equal(paused.session.transcriptionPaused, true);
  assert.equal(paused.session.metrics.audioBytes, 64000);
  assert.equal(transcribeCalls, 0);

  await manager.resumeTranscription();
  await manager._worker;
  const resumed = await manager.status(id, 0);
  assert.equal(resumed.session.transcriptionPaused, false);
  assert.equal(transcribeCalls, 2);
  await manager.stop(id);
});
