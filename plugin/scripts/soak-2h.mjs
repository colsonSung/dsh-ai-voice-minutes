import { appendFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { apply } from '../index.js';
import { createLiveManager } from '../live.js';

const seconds = Math.max(5, Number(process.env.SOAK_SECONDS || 7200));
const chunkMs = 10000;
const chunkBytes = 16000 * 2 * (chunkMs / 1000);
const inputPath = process.env.SOAK_INPUT || '/tmp/ai-minutes-soak-input.pcm';
const logPath = process.env.SOAK_LOG || `.opencode/soak-${seconds}s-${Date.now()}.jsonl`;
const pcm = await readFile(inputPath);
const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-soak-data-'));
await mkdir('.opencode', { recursive: true });

let service;
apply({
  provide(name, value) { if (name === 'minutes') service = value; },
  inject(dependencies, callback) {
    if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
    if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
  },
});

let captureStopped = false;
async function* capture() {
  let offset = 0;
  let timestamp = 0;
  const chunks = Math.ceil(seconds * 1000 / chunkMs);
  for (let index = 0; index < chunks && !captureStopped; index += 1) {
    const started = Date.now();
    const end = Math.min(offset + chunkBytes, pcm.length);
    const bytes = pcm.subarray(offset, end);
    offset = end >= pcm.length ? 0 : end;
    for (const source of ['mic', 'system']) {
      yield JSON.stringify({
        type: 'audio', source, timestamp, sampleRate: 16000, channels: 1,
        pcmBase64: bytes.toString('base64'),
      }) + '\n';
    }
    timestamp += chunkMs;
    await sleep(Math.max(0, chunkMs - (Date.now() - started)));
  }
  yield JSON.stringify({ type: 'done' }) + '\n';
}

const manager = createLiveManager(service, {
  dataDir,
  startCapture: async () => ({
    stdout: capture(),
    stop: async () => { captureStopped = true; },
  }),
  maxQueue: 48,
});

const session = await manager.start({ sourceLanguage: 'zh', targetLanguage: 'en' });
const startedAt = Date.now();
const startedRss = process.memoryUsage().rss;
let maxRss = startedRss;
let lastSeq = 0;
await appendFile(logPath, JSON.stringify({ type: 'start', at: new Date().toISOString(), seconds, session, dataDir }) + '\n');
console.log(JSON.stringify({ stage: 'started', seconds, id: session.id, dataDir, logPath }));

const timer = setInterval(async () => {
  try {
    const status = await manager.status(session.id, lastSeq);
    lastSeq = status.events.reduce((max, event) => Math.max(max, event.seq), lastSeq);
    maxRss = Math.max(maxRss, process.memoryUsage().rss);
    const row = {
      type: 'metrics', at: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      rss: process.memoryUsage().rss, session: status.session,
    };
    await appendFile(logPath, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  } catch (error) {
    console.error(JSON.stringify({ type: 'metrics-error', error: String(error) }));
  }
}, Math.min(60000, Math.max(10000, seconds * 100)));

await sleep(seconds * 1000);
clearInterval(timer);
const stopped = await manager.stop(session.id);
const status = await manager.status(session.id, 0);
maxRss = Math.max(maxRss, process.memoryUsage().rss);
const result = {
  type: 'result', at: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  startedRss, maxRss, rssGrowth: maxRss - startedRss, stopped, session: status.session,
  eventCounts: status.events.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] || 0) + 1 }), {}),
  dataDir,
};
await appendFile(logPath, JSON.stringify(result) + '\n');
console.log(JSON.stringify(result, null, 2));

const metrics = status.session.metrics;
const failures = [];
if (status.session.status !== 'stopped') failures.push('session did not stop cleanly');
if (status.session.degraded) failures.push('session is degraded');
if (metrics.droppedChunks !== 0) failures.push('chunks were dropped');
if (metrics.transcriptionFailures !== 0) failures.push('transcription failures');
if (metrics.translationFailures !== 0) failures.push('translation failures');
if (metrics.transcribedChunks === 0) failures.push('no transcribed chunks');
if (metrics.translatedChunks === 0) failures.push('no translated chunks');
if (metrics.queueDepth !== 0) failures.push('queue did not drain');
if (metrics.audioBytes < chunkBytes * 2) failures.push('insufficient audio bytes');
if (failures.length) throw new Error(failures.join('; '));
