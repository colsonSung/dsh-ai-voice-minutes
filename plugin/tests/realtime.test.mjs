import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { RealtimeManager } from '../realtime.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function pcm(value = 1000, samples = 160) {
  const bytes = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) bytes.writeInt16LE(index % 2 ? -value : value, index * 2);
  return bytes;
}

async function waitFor(predicate, message = 'condition') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for ' + message);
}

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-realtime-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const captures = [];
  const events = [];
  const manager = new RealtimeManager({
    dataDir,
    retryDelay: 0,
    transcribe: async () => 'transcript',
    translate: async (text) => 'translated:' + text,
    onEvent: (event) => events.push(event),
    startCapture: async () => {
      const stdout = new Readable({ read() {} });
      const capture = {
        stdout,
        stopCalls: 0,
        active: true,
        push(value) { stdout.push(value); },
        audio(source, bytes, timestamp) {
          stdout.push(JSON.stringify({
            type: 'audio', source, timestamp, sampleRate: 16000, channels: 1,
            pcmBase64: bytes.toString('base64'),
          }) + '\n');
        },
        done() { stdout.push(JSON.stringify({ type: 'done' }) + '\n'); },
        async stop() {
          this.stopCalls += 1;
          this.active = false;
          this.done();
          stdout.push(null);
        },
      };
      captures.push(capture);
      return capture;
    },
    ...options,
  });
  return { manager, dataDir, events, captures, capture: () => captures[0] };
}

function audioCounts(events) {
  return events.filter((event) => event.type === 'transcript').map((event) => event.text);
}

test('split JSONL is persisted per track and produces ordered transcript/translation events', async (t) => {
  const seenPcm = [];
  const { manager, dataDir, events, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => {
      seenPcm.push(bytes);
      return { text: chunk.source + ':' + chunk.chunkId + '.' };
    },
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  const mic = pcm(800);
  const system = pcm(1200);
  const first = JSON.stringify({ type: 'audio', source: 'mic', timestamp: 10, sampleRate: 16000, channels: 1, pcmBase64: mic.toString('base64') });
  const second = JSON.stringify({ type: 'audio', source: 'system', timestamp: 20, sampleRate: 16000, channels: 1, pcmBase64: system.toString('base64') });
  capture().push(first.slice(0, 17));
  capture().push(first.slice(17) + '\n' + second + '\n' + JSON.stringify({ type: 'done' }) + '\n');
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'), 'natural stop');

  assert.deepEqual(seenPcm, [mic, system]);
  assert.deepEqual(await readFile(join(dataDir, 'realtime', session.id, 'mic.pcm')), mic);
  assert.deepEqual(await readFile(join(dataDir, 'realtime', session.id, 'system.pcm')), system);
  // The transcripts come out as fast as they are recognised, so the exact
  // interleaving with the translations is timing, not contract.
  const types = events.map((event) => event.type);
  assert.equal(types.filter((type) => type === 'transcript').length, 2);
  assert.equal(types.filter((type) => type === 'translation').length, 2);
  assert.equal(types[0], 'status');
  assert.equal(types.at(-1), 'status');
  assert.deepEqual(audioCounts(events), ['mic:1.', 'system:2.']);
  const micTranslation = events.find((event) => event.type === 'translation' && event.chunkId === 1);
  const systemTranslation = events.find((event) => event.type === 'translation' && event.chunkId === 2);
  assert.ok(micTranslation && systemTranslation, 'both chunks are translated');
  assert.ok(
    events.indexOf(micTranslation) < events.indexOf(systemTranslation),
    'the translations keep the order of the chunks'
  );
  assert.equal(micTranslation.text, 'translated:mic:1.');
  assert.equal(micTranslation.translation, 'translated:mic:1.');
  assert.equal(micTranslation.timestamp, 10);

  const checkpoint = JSON.parse(await readFile(join(dataDir, 'realtime', session.id, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.status, 'stopped');
  assert.equal(checkpoint.metrics.audioBytes, mic.length + system.length);
  assert.equal(checkpoint.metrics.transcribedChunks, 2);

  const resumed = new RealtimeManager({ dataDir });
  const page = await resumed.status(session.id, 2);
  assert.deepEqual(page.events.map((event) => event.seq), [3, 4, 5, 6]);
  assert.equal(page.session.status, 'stopped');
});

test('the live pipeline publishes the translation while the model is still writing', async (t) => {
  const { manager, events, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => ({ text: 'chunk' + chunk.chunkId }),
    translateStream: async (text, context, onDelta) => {
      onDelta('I am', 'I am');
      onDelta('I am not sure', ' not sure');
      return { ok: true, result: { translation: 'I am not sure' } };
    },
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  capture().push(JSON.stringify({
    type: 'audio', source: 'mic', timestamp: 0, sampleRate: 16000, channels: 1,
    pcmBase64: pcm(800).toString('base64'),
  }) + '\n');
  await waitFor(() => events.some((event) => event.type === 'translation'), 'the translation');
  await manager.stop(session.id);

  const partials = events.filter((event) => event.type === 'translation' && event.partial);
  assert.ok(partials.length >= 1, 'the growing text is published before the sentence is done');
  assert.match(partials[0].translation, /I am/, 'the partial carries what has been written');
  const final = events.filter((event) => event.type === 'translation' && !event.partial);
  assert.equal(final.length, 1, 'the finished translation is published once');
  assert.equal(final[0].translation, 'I am not sure');
});

test('a slow translation does not delay the next caption, and translations keep their order', async (t) => {
  const gate = deferred();
  const order = [];
  const { manager, events, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => {
      order.push('transcribe:' + chunk.chunkId);
      return { text: 'chunk' + chunk.chunkId + '.' };
    },
    translate: async (text) => {
      if (text === 'chunk1.') await gate.promise;
      order.push('translate:' + text);
      return 'translated:' + text;
    },
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  for (const [index, value] of [800, 900].entries()) {
    capture().push(JSON.stringify({
      type: 'audio', source: 'mic', timestamp: index * 10, sampleRate: 16000, channels: 1,
      pcmBase64: pcm(value).toString('base64'),
    }) + '\n');
  }

  // The second caption is transcribed while the first translation waits.
  await waitFor(() => order.includes('transcribe:2'), 'the second transcription');
  assert.ok(order.includes('transcribe:2'), 'the next caption does not wait for the translation');
  assert.ok(!order.includes('translate:chunk1.'), 'the first translation is still pending');

  gate.resolve();
  await waitFor(() => order.includes('translate:chunk2.'), 'the translations to finish');
  await manager.stop(session.id);

  const translations = events.filter((event) => event.type === 'translation');
  assert.equal(translations.length, 2);
  assert.equal(translations[0].chunkId, 1, 'the translations keep the order of the chunks');
  assert.equal(translations[1].chunkId, 2);
});

test('a slow translation does not hold up the next transcription', async (t) => {
  const gate = deferred();
  const order = [];
  const { manager, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => {
      order.push('transcribe:' + chunk.chunkId);
      return { text: 'chunk' + chunk.chunkId + '.' };
    },
    translate: async (text) => {
      if (text === 'chunk1.') await gate.promise;
      order.push('translate:' + text);
      return 'translated:' + text;
    },
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  for (const [index, value] of [800, 900].entries()) {
    capture().push(JSON.stringify({
      type: 'audio', source: 'mic', timestamp: index * 10, sampleRate: 16000, channels: 1,
      pcmBase64: pcm(value).toString('base64'),
    }) + '\n');
  }

  // The first translation is still waiting, but the next chunk is transcribed.
  await waitFor(() => order.includes('transcribe:2'), 'the second transcription');
  assert.ok(order.includes('transcribe:2'), 'the next caption does not wait for the translation');
  assert.ok(!order.includes('translate:chunk1.'), 'the translation is still pending');

  gate.resolve();
  await waitFor(() => order.includes('translate:chunk2.'), 'the translations to finish');
  await manager.stop(session.id);
});

test('transcription is sequential and transient ASR/translation failures are retried', async (t) => {
  let transcribeCalls = 0;
  let translationCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const { manager, capture, events } = await fixture(t, {
    maxRetries: 2,
    transcribe: async (_bytes, chunk) => {
      transcribeCalls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await yieldToEventLoop();
      active -= 1;
      if (chunk.chunkId === 1 && transcribeCalls < 3) throw new Error('temporary ASR outage');
      return 'text:' + chunk.chunkId + '.';
    },
    translate: async (text) => {
      translationCalls += 1;
      if (translationCalls === 1) throw new Error('temporary translation outage');
      return 'translated:' + text;
    },
  });
  const session = await manager.start();
  capture().audio('mix', pcm(), 1);
  capture().audio('mix', pcm(), 2);
  capture().done();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'));

  assert.equal(maximumActive, 1);
  assert.equal(transcribeCalls, 4);
  assert.equal(translationCalls, 3);
  assert.deepEqual(audioCounts(events), ['text:1.', 'text:2.']);
  const status = await manager.status(session.id);
  assert.equal(status.session.metrics.retries, 3);
  assert.equal(status.session.degraded, false);
  assert.equal(status.events.some((event) => event.type === 'error'), false);
});

test('queue overflow is bounded, explicitly degraded, and never loses raw PCM', async (t) => {
  const gate = deferred();
  let first = true;
  const { manager, capture, dataDir } = await fixture(t, {
    maxQueue: 2,
    transcribe: async (_bytes, chunk) => {
      if (first) { first = false; await gate.promise; }
      return 'text:' + chunk.chunkId + '.';
    },
  });
  const session = await manager.start();
  const bytes = pcm(500, 800);
  for (let index = 0; index < 5; index += 1) capture().audio('mix', bytes, index);
  await waitFor(async () => (await manager.status(session.id)).session.metrics.droppedChunks === 2, 'queue overflow');
  let status = await manager.status(session.id);
  assert.equal(status.session.metrics.queueDepth, 2);
  assert.equal(status.session.metrics.maxQueueDepth, 2);
  assert.equal(status.session.degraded, true);
  assert.ok(status.events.some((event) => event.type === 'error' && event.code === 'queue-overflow'));
  capture().done();
  gate.resolve();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'), 'drain');
  status = await manager.status(session.id);
  assert.equal(status.session.metrics.queueDepth, 0);
  assert.equal(status.session.metrics.droppedChunks, 2);
  assert.equal((await readFile(join(dataDir, 'realtime', session.id, 'mix.pcm'))).length, bytes.length * 5);
});

test('stop waits for accepted work, is idempotent, and leaves no temporary state', async (t) => {
  const gate = deferred();
  const { manager, capture, dataDir } = await fixture(t, {
    transcribe: async () => { await gate.promise; return 'last words'; },
  });
  const session = await manager.start();
  capture().audio('mic', pcm(), 1);
  await yieldToEventLoop();
  const stopping = manager.stop(session.id);
  await yieldToEventLoop();
  assert.equal((await manager.status(session.id)).session.status, 'stopping');
  assert.equal(capture().stopCalls, 1);
  gate.resolve();
  const stopped = await stopping;
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.metrics.queueDepth, 0);
  assert.equal(capture().active, false);
  const again = await manager.stop(session.id);
  assert.equal(again.status, 'stopped');
  assert.equal(capture().stopCalls, 1);
  const names = await readdir(join(dataDir, 'realtime', session.id));
  assert.equal(names.some((name) => name.endsWith('.tmp')), false);
  const checkpoint = JSON.parse(await readFile(join(dataDir, 'realtime', session.id, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.captureAttached, false);
});

test('silent chunks are persisted but not transcribed', async (t) => {
  let calls = 0;
  const { manager, capture } = await fixture(t, { transcribe: async () => { calls += 1; return 'unexpected'; } });
  const session = await manager.start();
  capture().audio('system', Buffer.alloc(3200), 1);
  capture().done();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'));
  assert.equal(calls, 0);
  assert.equal((await manager.status(session.id)).session.metrics.skippedChunks, 1);
});

test('malformed input, capture errors, and permanent callback failures emit sequenced errors', async (t) => {
  const { manager, capture, events } = await fixture(t, {
    maxRetries: 1,
    transcribe: async () => { throw new Error('ASR unavailable'); },
  });
  const session = await manager.start();
  capture().push('{not-json}\n');
  capture().push(JSON.stringify({ type: 'error', message: 'permission denied' }) + '\n');
  capture().audio('mix', pcm(), 1);
  capture().done();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'));
  const errors = events.filter((event) => event.type === 'error');
  assert.deepEqual(errors.map((event) => event.code), ['invalid-json', 'capture-error', 'transcription-failed']);
  assert.ok(errors.every((event, index) => event.seq > (index ? errors[index - 1].seq : 0)));
  assert.equal((await manager.status(session.id)).session.degraded, true);
});

test('mix and independent tracks are all persisted but never double-transcribed', async (t) => {
  const transcribed = [];
  const { manager, capture, dataDir } = await fixture(t, {
    transcribe: async (_bytes, chunk) => { transcribed.push(chunk.source); return chunk.source; },
  });
  const session = await manager.start();
  capture().audio('mix', pcm(600), 1);
  capture().audio('mic', pcm(700), 1);
  capture().audio('system', pcm(800), 1);
  capture().done();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'));
  assert.deepEqual(transcribed, ['mix']);
  assert.equal((await manager.status(session.id)).session.metrics.suppressedChunks, 2);
  for (const source of ['mix', 'mic', 'system']) {
    assert.equal((await readFile(join(dataDir, 'realtime', session.id, source + '.pcm'))).length, 320);
  }
});

test('event listeners receive sequenced notifications without concurrent emissions', async (t) => {
  const gate = deferred();
  const transcriptStarted = deferred();
  let active = 0;
  let maximumActive = 0;
  const { manager, capture } = await fixture(t, {
    onEvent: async (event) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (event.type === 'transcript') {
        transcriptStarted.resolve();
        await gate.promise;
      }
      active -= 1;
    },
  });
  const session = await manager.start();
  capture().audio('mix', pcm(), 1);
  await transcriptStarted.promise;
  capture().push(JSON.stringify({ type: 'error', detail: 'capture warning' }) + '\n');
  await waitFor(async () => (await manager.status(session.id)).session.metrics.captureErrors === 1, 'capture error');
  await new Promise((resolve) => setTimeout(resolve, 20));
  gate.resolve();
  capture().done();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'));
  assert.equal(maximumActive, 1);
});

test('queued audio uses disk descriptors with bounded heap growth', async (t) => {
  if (typeof globalThis.gc !== 'function') {
    t.skip('run with node --expose-gc for the heap assertion');
    return;
  }
  const gate = deferred();
  let releaseFirst;
  const firstStarted = deferred();
  const { manager, capture } = await fixture(t, {
    maxQueue: 1000,
    transcribe: async (_bytes, chunk) => {
      if (chunk.chunkId === 1) {
        releaseFirst = gate.promise;
        firstStarted.resolve();
        await releaseFirst;
      }
      return 'text';
    },
  });
  const session = await manager.start();
  const bytes = pcm(700, 32768);
  capture().audio('mix', bytes, 0);
  await firstStarted.promise;
  globalThis.gc();
  const baseline = process.memoryUsage().heapUsed;
  for (let index = 1; index <= 160; index += 1) {
    capture().audio('mix', bytes, index);
    await waitFor(async () => (await manager.status(session.id)).session.metrics.receivedChunks === index + 1, 'PCM append');
  }
  await waitFor(async () => (await manager.status(session.id)).session.metrics.queueDepth === 160, 'disk queue fill');
  globalThis.gc();
  const growth = process.memoryUsage().heapUsed - baseline;
  assert.ok(growth < 6 * 1024 * 1024, `heap grew by ${growth} bytes while queueing 10 MiB of PCM`);
  const status = await manager.status(session.id);
  assert.equal(status.session.metrics.queueDepth, 160);
  assert.equal(status.session.metrics.audioBytes, bytes.length * 161);
  capture().done();
  gate.resolve();
  await waitFor(() => manager.status(session.id).then((value) => value.session.status === 'stopped'), 'final drain');
});

test('caption fragments stay in one sentence until punctuation ends it', async (t) => {
  const { manager, events, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => ({ text: ['我们今天讨论', '一下进展。'][chunk.chunkId - 1] || '' }),
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  for (const [index, value] of [800, 900].entries()) {
    capture().push(JSON.stringify({
      type: 'audio', source: 'mic', timestamp: index * 3000, sampleRate: 16000, channels: 1,
      pcmBase64: pcm(value).toString('base64'),
    }) + '\n');
  }
  await waitFor(() => events.filter((event) => event.type === 'transcript').length >= 2, 'both fragments');
  await manager.stop(session.id);

  const transcripts = events.filter((event) => event.type === 'transcript');
  assert.equal(transcripts.length, 2, 'each fragment updates the same caption, not a new line');
  assert.equal(transcripts[0].chunkId, transcripts[1].chunkId, 'the sentence keeps one identity');
  assert.equal(transcripts[0].text, '我们今天讨论');
  assert.equal(transcripts[0].partial, true, 'the growing caption is marked provisional');
  assert.equal(transcripts[1].text, '我们今天讨论一下进展。');
  assert.equal(transcripts[1].partial, false, 'terminal punctuation closes the sentence');
});

test('a pause closes the open caption and stop flushes the last one', async (t) => {
  const { manager, events, capture } = await fixture(t, {
    transcribe: async (bytes, chunk) => ({ text: chunk.chunkId === 1 ? '没有标点的半句话' : '下一句' }),
  });
  const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
  capture().push(JSON.stringify({
    type: 'audio', source: 'mic', timestamp: 0, sampleRate: 16000, channels: 1,
    pcmBase64: pcm(800).toString('base64'),
  }) + '\n');
  await waitFor(() => events.some((event) => event.type === 'transcript'), 'the first fragment');
  capture().push(JSON.stringify({
    type: 'audio', source: 'mic', timestamp: 3000, sampleRate: 16000, channels: 1,
    pcmBase64: pcm(0).toString('base64'),
  }) + '\n');
  await waitFor(() => events.some((event) => event.type === 'transcript' && event.partial === false), 'the pause closes the caption');
  capture().push(JSON.stringify({
    type: 'audio', source: 'mic', timestamp: 6000, sampleRate: 16000, channels: 1,
    pcmBase64: pcm(900).toString('base64'),
  }) + '\n');
  await waitFor(() => events.some((event) => event.type === 'transcript' && event.text === '下一句'), 'the next caption');
  await manager.stop(session.id);

  const transcripts = events.filter((event) => event.type === 'transcript');
  const firstClosed = transcripts.find((event) => event.text === '没有标点的半句话' && event.partial === false);
  assert.ok(firstClosed, 'the pause finalizes the unfinished sentence');
  const last = transcripts.filter((event) => event.text === '下一句').at(-1);
  assert.equal(last.partial, false, 'stop flushes the last open sentence');
  assert.notEqual(firstClosed.chunkId, last.chunkId, 'the next sentence gets a new line');
});
