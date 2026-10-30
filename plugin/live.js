import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { RealtimeManager } from './realtime.js';

/** Wrap signed little-endian PCM16 in a RIFF/WAVE header. */
export function pcmToWav(pcm, sampleRate = 16000, channels = 1) {
  const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const rate = Math.max(1, Math.floor(sampleRate));
  const channelCount = Math.max(1, Math.floor(channels));
  const blockAlign = channelCount * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(bytes.length + 36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

/**
 * Aggregate small native frames into bounded per-track chunks while preserving
 * the native error/done protocol. Only a few seconds of PCM are held in memory.
 */
/**
 * Loudness of one PCM frame. RMS follows how loudly someone is actually
 * speaking, unlike a single-sample peak, which makes quiet and loud speech
 * look the same. The small floor is room noise, not speech.
 */
function levelOf(bytes) {
  const samples = Math.floor(bytes.length / 2);
  if (!samples) return 0;
  let energy = 0;
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    const sample = bytes.readInt16LE(offset);
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / samples);
  return Math.min(1, Math.max(0, (rms - 60) / 1200));
}

export async function * createCaptureStream(input, options = {}) {
  const chunkMs = Math.max(10, Math.floor(options.chunkMs ?? 10000));
  const chunkBytes = Math.max(2, Math.floor(16000 * 2 * chunkMs / 1000));
  const decoder = new StringDecoder('utf8');
  const states = new Map();
  const levels = new Map();
  let buffered = '';

  function emptyState(timestamp) {
    return { timestamp, parts: [], length: 0 };
  }

  async function * transform(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      yield line + '\n';
      return;
    }
    if (event?.type === 'audio' && typeof event.pcmBase64 === 'string') {
      const bytes = Buffer.from(event.pcmBase64, 'base64');
      // The level is measured on the frames themselves, so the overlay can move
      // with the voice instead of once every chunk.
      const now = Date.now();
      // The first frame always reports, so the meter never stays silent.
      const meter = levels.get(event.source) || { peak: 0, at: 0 };
      meter.peak = Math.max(meter.peak, levelOf(bytes));
      if (now - meter.at >= 70) {
        levels.set(event.source, { peak: 0, at: now });
        yield JSON.stringify({
          type: 'level', source: event.source, level: Math.min(1, meter.peak),
        }) + '\n';
      } else {
        levels.set(event.source, meter);
      }
      let state = states.get(event.source) || emptyState(Number(event.timestamp) || 0);
      state.parts.push(bytes);
      state.length += bytes.length;
      while (state.length >= chunkBytes) {
        const joined = Buffer.concat(state.parts);
        const output = joined.subarray(0, chunkBytes);
        const remainder = joined.subarray(chunkBytes);
        yield JSON.stringify({ ...event, timestamp: state.timestamp, pcmBase64: output.toString('base64') }) + '\n';
        state = {
          timestamp: state.timestamp + chunkMs,
          parts: remainder.length ? [remainder] : [],
          length: remainder.length,
        };
      }
      states.set(event.source, state);
      return;
    }
    if (event?.type === 'done') {
      for (const [source, state] of states) {
        if (state.length > 0) {
          yield JSON.stringify({
            type: 'audio', source, timestamp: state.timestamp, sampleRate: 16000, channels: 1,
            pcmBase64: Buffer.concat(state.parts).toString('base64'),
          }) + '\n';
        }
      }
      states.clear();
      yield line + '\n';
      return;
    }
    yield line + '\n';
  }

  for await (const chunk of input) {
    buffered += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const lines = buffered.split('\n');
    buffered = lines.pop() || '';
    for (const line of lines) {
      for await (const output of transform(line)) yield output;
    }
  }
  buffered += decoder.end();
  if (buffered.trim()) {
    for await (const output of transform(buffered)) yield output;
  }
  for (const [source, state] of states) {
    if (state.length > 0) {
      yield JSON.stringify({
        type: 'audio', source, timestamp: state.timestamp, sampleRate: 16000, channels: 1,
        pcmBase64: Buffer.concat(state.parts).toString('base64'),
      }) + '\n';
    }
  }
}

function startNativeCapture(service, options = {}) {
  const capturePath = options.capturePath || fileURLToPath(new URL('./native/bin/audio-capture', import.meta.url));
  return async function startCapture(captureOptions = {}) {
    if (process.platform !== 'darwin') throw new Error('Native dual-track capture currently requires macOS');
    const child = spawn(capturePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', () => {});
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        child.off('error', onError);
        resolve();
      };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });

    let killTimer = null;
    const stop = async () => {
      if (child.exitCode !== null || child.signalCode) return;
      if (child.stdin.writable) {
        child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
        child.stdin.end();
      }
      if (!killTimer) {
        killTimer = setTimeout(() => child.kill('SIGTERM'), 5000);
        killTimer.unref();
        child.once('close', () => clearTimeout(killTimer));
      }
    };
    if (captureOptions.signal) {
      captureOptions.signal.addEventListener('abort', () => { void stop(); }, { once: true });
    }
    child.stdin.write(JSON.stringify({
      command: 'start',
      mic: captureOptions.mic !== false,
      system: captureOptions.system !== false,
      mixed: captureOptions.mixed === true,
    }) + '\n');
    return {
      // How much audio becomes one caption. A shorter chunk shows the text
      // sooner; the final transcript is refined by the pass two model anyway.
      stdout: createCaptureStream(child.stdout, {
        chunkMs: Number(options.chunkMs) || Number(service.config.liveChunkSeconds) * 1000 || 5000,
      }),
      stop,
    };
  };
}

/** Build the production RealtimeManager over the existing MinutesService. */
export function createLiveManager(service, options = {}) {
  return new RealtimeManager({
    dataDir: options.dataDir || service.config.dataDir,
    startCapture: options.startCapture || startNativeCapture(service, options),
    transcribe: async (bytes, context) => {
      const wav = pcmToWav(bytes, context.sampleRate, context.channels);
      return service.transcribe(
        { base64: wav.toString('base64') },
        {
          filename: `live-${context.source}-${context.chunkId}.wav`,
          language: context.sourceLanguage && context.sourceLanguage !== 'auto' ? context.sourceLanguage : undefined,
          hotwords: context.hotwords || undefined,
          itn: context.itn !== false,
        },
      );
    },
    translate: (text, context) => service.translate(text, context),
    translateStream: (text, context, onDelta) => service.translateStream(text, context, onDelta),
    onEvent: options.onEvent,
    onLevel: options.onLevel,
    maxQueue: options.maxQueue ?? 24,
    maxRetries: options.maxRetries ?? 2,
    retryDelay: options.retryDelay ?? 250,
    energyThreshold: options.energyThreshold ?? 350,
  });
}


/** Convert a realtime checkpoint and event journal into a library meeting. */
export function liveMeetingFromStatus(status) {
  const session = status.session;
  const chunks = new Map();
  for (const event of status.events || []) {
    if (!['transcript', 'translation'].includes(event.type)) continue;
    const key = `${event.source || ''}:${event.chunkId ?? event.seq}`;
    const previous = chunks.get(key) || {};
    // 音轨里的字节位置换算成秒，方便会议结束后对齐说话人区间
    const offset = Number(event.offset ?? previous.offset);
    const length = Number(event.length ?? previous.length);
    const audioStart = Number.isFinite(offset) ? offset / 2 / 16000 : null;
    const audioEnd = Number.isFinite(offset) ? (offset + (Number.isFinite(length) ? length : 0)) / 2 / 16000 : null;
    chunks.set(key, {
      ...previous,
      start: Number(event.timestamp) / 1000 || previous.start || 0,
      end: Number(event.timestamp) / 1000 || previous.end || 0,
      // 说话人优先用真正的分人结果，音轨名只是还没有分人时的占位
      speaker: event.speaker || previous.speaker || event.source || '',
      text: event.type === 'transcript' ? event.text || previous.text || '' : event.transcript || previous.text || '',
      translation: event.type === 'translation' ? event.translation || event.text || previous.translation || '' : previous.translation || '',
      chunkId: event.chunkId ?? previous.chunkId,
      source: event.source || previous.source || '',
      offset: Number.isFinite(offset) ? offset : previous.offset,
      length: Number.isFinite(length) ? length : previous.length,
      audioStart: audioStart ?? previous.audioStart ?? null,
      audioEnd: audioEnd ?? previous.audioEnd ?? null,
    });
  }
  const segments = [...chunks.values()].sort((a, b) => (a.chunkId || 0) - (b.chunkId || 0));
  const transcript = segments.map((segment) => segment.text).filter(Boolean).join('\n');
  const firstText = segments.find((segment) => segment.text)?.text || '';
  return {
    id: session.id,
    title: firstText ? firstText.slice(0, 48) : `Live meeting ${session.startedAt || ''}`,
    createdAt: session.startedAt,
    updatedAt: session.endedAt || session.startedAt,
    duration: session.durationSeconds || 0,
    speakers: [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))],
    transcript,
    transcriptLength: transcript.length,
    segments,
    minutes: null,
    topicCount: 0,
    realtime: true,
    liveStatus: session.status,
    excerpt: (session.minutes?.summary || transcript).slice(0, 160),
    size: Number(session.metrics?.audioBytes) || 0,
    creator: session.creator || userInfo().username,
  };
}

/** Read every persisted realtime session, including sessions from earlier Host runs. */
export async function listLiveMeetings(manager) {
  const root = join(manager.dataDir, 'realtime');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const meetings = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^realtime-[A-Za-z0-9-]+$/.test(entry.name)) continue;
    try {
      const status = await manager.status(entry.name, 0);
      meetings.push(liveMeetingFromStatus(status));
    } catch {
      /* Ignore an incomplete session directory. */
    }
  }
  meetings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return meetings;
}
