import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCES = new Set(['mic', 'system', 'mix']);
/** How many translations may be in flight at the same time. */
const MAX_CONCURRENT_TRANSLATIONS = 8;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function freshMetrics() {
  return {
    receivedChunks: 0,
    queuedChunks: 0,
    droppedChunks: 0,
    transcribedChunks: 0,
    translatedChunks: 0,
    skippedChunks: 0,
    suppressedChunks: 0,
    transcriptionFailures: 0,
    translationFailures: 0,
    captureErrors: 0,
    retries: 0,
    queueDepth: 0,
    maxQueueDepth: 0,
    audioBytes: 0,
  };
}

function publicSession(session) {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds: session.durationSeconds,
    degraded: session.degraded,
    transcriptionPaused: Boolean(session.transcriptionPaused),
    metrics: { ...session.metrics },
    captureAttached: Boolean(session.captureAttached),
    sourceLanguage: session.sourceLanguage || '',
    targetLanguage: session.targetLanguage || '',
    incognito: Boolean(session.incognito),
    hotwords: session.hotwords || '',
  };
}

function callbackText(result) {
  if (result && typeof result === 'object' && result.ok === false) {
    throw new Error(result.error?.message || result.error || 'callback failed');
  }
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return result == null ? '' : String(result);
  if (typeof result.text === 'string') return result.text;
  if (typeof result.transcript === 'string') return result.transcript;
  if (typeof result.translation === 'string') return result.translation;
  if (result.result !== undefined) return callbackText(result.result);
  return '';
}

/**
 * Host-independent realtime audio processing.
 *
 * startCapture receives {sessionId, signal, ...startOptions} and returns an
 * object whose stdout is an async iterable of JSONL bytes/strings and whose
 * stop() method requests capture termination. Only one chunk's PCM is held by
 * the processor; queued chunks are file/offset/length descriptors.
 */
export class RealtimeManager {
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('RealtimeManager requires dataDir');
    this.dataDir = options.dataDir;
    this.startCapture = options.startCapture;
    this.transcribe = options.transcribe;
    this.translate = options.translate;
    this.translateStream = options.translateStream;
    this.onEvent = options.onEvent;
    this.onLevel = options.onLevel;
    this.maxQueue = Math.max(0, Math.floor(options.maxQueue ?? 8));
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.retryDelay = Math.max(0, options.retryDelay ?? 100);
    this.energyThreshold = Math.max(0, options.energyThreshold ?? 0);
    this.maxChunkBytes = Math.max(2, options.maxChunkBytes ?? 8 * 1024 * 1024);
    this._session = null;
    this._sessionDir = null;
    this._capture = null;
    this._capturePromise = null;
    this._stopPromise = null;
    this._abortController = null;
    this._queue = [];
    this._worker = null;
    this._sequence = 0;
    this._chunkSequence = 0;
    this._trackOffsets = new Map();
    this._trackMode = null;
    this._queueWarning = false;
    this._doneReceived = false;
    this._finalized = false;
    this._lastLevelAt = 0;
    this._translationQueue = [];
    this._activeTranslations = 0;
    this._translationDrain = Promise.resolve();
    // A caption is a sentence, not an ASR chunk. Fragments update this line
    // until punctuation, a pause, or the end of the meeting closes it.
    this._captionLines = new Map();
    this._eventChain = Promise.resolve();
    this._checkpointChain = Promise.resolve();
  }

  async start(options = {}) {
    if (this._session && ['recording', 'stopping'].includes(this._session.status)) {
      throw new Error('A realtime session is already active');
    }
    if (typeof this.startCapture !== 'function') throw new Error('startCapture callback is required');
    if (typeof this.transcribe !== 'function') throw new Error('transcribe callback is required');

    const id = 'realtime-' + Date.now() + '-' + randomUUID().slice(0, 8);
    this._session = {
      id,
      status: 'recording',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationSeconds: 0,
      degraded: false,
      transcriptionPaused: false,
      metrics: freshMetrics(),
      captureAttached: false,
      sourceLanguage: options.sourceLanguage || '',
      targetLanguage: options.targetLanguage || '',
      incognito: Boolean(options.incognito),
      hotwords: options.hotwords || '',
    };
    if (this._session.incognito) {
      this._sessionDir = await mkdtemp(join(tmpdir(), 'ai-minutes-incognito-'));
    } else {
      this._sessionDir = join(this.dataDir, 'realtime', id);
    }
    this._capture = null;
    this._capturePromise = null;
    this._stopPromise = null;
    this._abortController = new AbortController();
    this._queue = [];
    this._worker = null;
    this._sequence = 0;
    this._chunkSequence = 0;
    this._trackOffsets = new Map();
    this._trackMode = null;
    this._queueWarning = false;
    this._doneReceived = false;
    this._finalized = false;
    this._captionLines = new Map();
    this._eventChain = Promise.resolve();
    this._checkpointChain = Promise.resolve();
    await mkdir(this._sessionDir, { recursive: true });
    await this._emit('status', { detail: 'recording' });

    try {
      const capture = await this.startCapture({
        ...options,
        sessionId: id,
        signal: this._abortController.signal,
      });
      const stream = capture?.stdout || capture;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        throw new Error('startCapture must return stdout as an async iterable');
      }
      this._capture = capture;
      this._session.captureAttached = true;
      await this._checkpoint();
      this._capturePromise = this._consumeCapture(capture);
      return this._snapshot();
    } catch (error) {
      this._session.captureAttached = false;
      this._session.degraded = true;
      await this._emit('error', { code: 'capture-start', detail: messageOf(error) });
      await this._finalize('error');
      throw error;
    }
  }

  async pauseTranscription(id = this._session?.id) {
    if (!this._session || id !== this._session.id) throw new Error('Unknown realtime session: ' + id);
    if (this._session.transcriptionPaused) return this._snapshot();
    this._session.transcriptionPaused = true;
    await this._emit('status', { detail: 'transcription-paused' });
    return this._snapshot();
  }

  async resumeTranscription(id = this._session?.id) {
    if (!this._session || id !== this._session.id) throw new Error('Unknown realtime session: ' + id);
    if (!this._session.transcriptionPaused) return this._snapshot();
    this._session.transcriptionPaused = false;
    await this._emit('status', { detail: 'transcription-resumed' });
    this._ensureWorker();
    return this._snapshot();
  }

  async stop(id = this._session?.id) {
    if (!this._session || id !== this._session.id) throw new Error('Unknown realtime session: ' + id);
    if (['stopped', 'error'].includes(this._session.status)) return this._snapshot();
    if (this._stopPromise) return this._stopPromise;
    this._stopPromise = this._stopCapture();
    return this._stopPromise;
  }

  async status(idOrOptions = this._session?.id, after = 0) {
    let id = idOrOptions;
    if (idOrOptions && typeof idOrOptions === 'object') {
      id = idOrOptions.id;
      after = idOrOptions.after ?? 0;
    }
    if (!id) throw new Error('A realtime session id is required');
    let session;
    if (this._session?.id === id) {
      session = this._snapshot();
    } else {
      const checkpointPath = this._sessionDir
        ? join(this._sessionDir, 'checkpoint.json')
        : join(this.dataDir, 'realtime', id, 'checkpoint.json');
      session = publicSession(JSON.parse(await readFile(checkpointPath, 'utf8')));
    }
    const events = await this._readEvents(id, Math.max(0, Number(after) || 0));
    return { session, events };
  }

  _snapshot() {
    const session = this._session;
    session.durationSeconds = this._durationSeconds(session);
    return publicSession(session);
  }

  _durationSeconds(session) {
    const start = Date.parse(session.startedAt);
    const end = session.endedAt ? Date.parse(session.endedAt) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.round(end - start) / 1000);
  }

  _eventsPath(id = this._session?.id) {
    if (this._sessionDir) return join(this._sessionDir, 'events.jsonl');
    return join(this.dataDir, 'realtime', id, 'events.jsonl');
  }

  _checkpointPath() {
    return join(this._sessionDir, 'checkpoint.json');
  }

  async _readEvents(id, after) {
    const events = [];
    const stream = createReadStream(this._eventsPath(id), { encoding: 'utf8' });
    stream.on('error', () => {});
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.seq > after) events.push(event);
        } catch {
          /* A partially written final line is not a usable event. */
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return events;
  }

  _checkpoint() {
    if (!this._session || !this._sessionDir) return Promise.resolve();
    const snapshot = {
      ...this._session,
      durationSeconds: this._durationSeconds(this._session),
      metrics: { ...this._session.metrics },
      nextSeq: this._sequence + 1,
      trackMode: this._trackMode,
      trackOffsets: Object.fromEntries(this._trackOffsets),
    };
    const path = this._checkpointPath();
    const temporary = path + '.tmp';
    this._checkpointChain = this._checkpointChain.catch(() => {}).then(async () => {
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporary, path);
    });
    return this._checkpointChain;
  }

  _emit(type, fields = {}) {
    const event = {
      seq: ++this._sequence,
      type,
      source: '',
      text: '',
      translation: '',
      timestamp: new Date().toISOString(),
      detail: '',
      ...fields,
    };
    this._eventChain = this._eventChain.catch(() => {}).then(async () => {
      await appendFile(this._eventsPath(), JSON.stringify(event) + '\n', 'utf8');
      if (this.onEvent) await this.onEvent(event);
      await this._checkpoint();
    });
    return this._eventChain;
  }

  async _stopCapture() {
    this._session.status = 'stopping';
    const statusEmitted = this._emit('status', { detail: 'stopping' });
    const capture = this._capture;
    const stopped = (async () => {
      try {
        if (typeof capture?.stop === 'function') await capture.stop();
        else if (typeof capture?.kill === 'function') capture.kill();
        else this._abortController?.abort();
        return null;
      } catch (error) {
        return error;
      }
    })();
    await statusEmitted;
    const stopError = await stopped;
    if (stopError) {
      this._session.degraded = true;
      await this._emit('error', { code: 'capture-stop', detail: messageOf(stopError) });
      this._abortController?.abort();
    }
    if (this._capturePromise) {
      await this._capturePromise;
    } else {
      // The last translations are still in flight, and the meeting is saved
      // from the event journal, so they have to land first.
      await this._awaitTranslations();
      await this._finalize('stopped');
    }
    return this._snapshot();
  }

  async _consumeCapture(capture) {
    const stream = capture.stdout || capture;
    const decoder = new StringDecoder('utf8');
    let buffered = '';
    let failed = false;
    try {
      for await (const chunk of stream) {
        buffered += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const lines = buffered.split('\n');
        buffered = lines.pop() || '';
        for (const line of lines) {
          await this._handleLine(line);
          if (this._doneReceived) break;
        }
        if (this._doneReceived) break;
      }
      if (!this._doneReceived) {
        buffered += decoder.end();
        if (buffered.trim()) await this._handleLine(buffered);
      }
    } catch (error) {
      failed = true;
      this._session.degraded = true;
      await this._emit('error', { code: 'capture-stream', detail: messageOf(error) });
    } finally {
      try {
        while (this._worker) await this._worker;
      } catch (error) {
        failed = true;
        this._session.degraded = true;
        await this._emit('error', { code: 'processing', detail: messageOf(error) });
      }
      this._queue.length = 0;
      if (this._session) this._session.metrics.queueDepth = 0;
      this._capture = null;
      this._abortController = null;
      // The translations of the last chunks are still in flight; the meeting
      // is saved from the event journal, so they have to land first.
      await this._awaitTranslations();
      await this._finalize(failed ? 'error' : 'stopped');
    }
  }

  async _handleLine(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this._session.degraded = true;
      this._session.metrics.captureErrors += 1;
      await this._emit('error', { code: 'invalid-json', detail: messageOf(error) });
      return;
    }
    if (event?.type === 'level') {
      this._reportLevel(event.source, Number(event.level) || 0);
    } else if (event?.type === 'audio') {
      await this._acceptAudio(event);
    } else if (event?.type === 'error') {
      this._session.degraded = true;
      this._session.metrics.captureErrors += 1;
      await this._emit('error', {
        code: 'capture-error',
        source: SOURCES.has(event.source) ? event.source : '',
        detail: String(event.detail ?? event.message ?? event.error ?? 'capture failed'),
        timestamp: event.timestamp ?? new Date().toISOString(),
      });
    } else if (event?.type === 'done') {
      this._doneReceived = true;
    } else if (event?.type === 'started') {
      await this._checkpoint();
    } else {
      this._session.degraded = true;
      this._session.metrics.captureErrors += 1;
      await this._emit('error', { code: 'invalid-event', detail: 'Unknown capture event type' });
    }
  }

  /**
   * Report how loud the room is right now, so the overlay can move its
   * waveform with the voice. It is a transient signal, not part of the
   * journal, so it never grows the event log.
   */
  _reportLevel(source, level) {
    if (typeof this.onLevel !== 'function') return;
    const value = Math.min(1, Math.max(0, Number(level) || 0));
    this._session.metrics.audioLevel = value;
    void this.onLevel({ source, level: value });
  }

  async _acceptAudio(event) {
    if (!SOURCES.has(event.source) || event.sampleRate !== 16000 || event.channels !== 1 || typeof event.pcmBase64 !== 'string') {
      this._session.degraded = true;
      this._session.metrics.captureErrors += 1;
      await this._emit('error', { code: 'invalid-audio', detail: 'Expected PCM16 mono 16 kHz audio with source mic, system, or mix' });
      return;
    }
    const bytes = Buffer.from(event.pcmBase64, 'base64');
    if (bytes.length > this.maxChunkBytes) {
      this._session.degraded = true;
      this._session.metrics.captureErrors += 1;
      await this._emit('error', { code: 'invalid-audio', detail: 'Audio chunk exceeds maxChunkBytes' });
      return;
    }
    if (!this._trackMode) this._trackMode = event.source === 'mix' ? 'mix' : 'separate';
    const offset = this._trackOffsets.get(event.source) || 0;
    const path = join(this._sessionDir, event.source + '.pcm');
    await appendFile(path, bytes);
    this._trackOffsets.set(event.source, offset + bytes.length);
    this._session.metrics.receivedChunks += 1;
    this._session.metrics.audioBytes += bytes.length;

    const descriptor = {
      chunkId: ++this._chunkSequence,
      sessionId: this._session.id,
      source: event.source,
      timestamp: event.timestamp,
      sampleRate: event.sampleRate,
      channels: event.channels,
      path,
      offset,
      length: bytes.length,
    };
    if (this._queue.length >= this.maxQueue) {
      this._session.metrics.droppedChunks += 1;
      this._session.degraded = true;
      if (!this._queueWarning) {
        this._queueWarning = true;
        await this._emit('error', {
          code: 'queue-overflow',
          source: event.source,
          timestamp: event.timestamp ?? new Date().toISOString(),
          detail: 'Transcription queue full; raw PCM was persisted and the chunk was dropped from live transcription',
        });
      } else {
        await this._checkpoint();
      }
      return;
    }
    this._queue.push(descriptor);
    this._session.metrics.queuedChunks += 1;
    this._session.metrics.queueDepth = this._queue.length;
    this._session.metrics.maxQueueDepth = Math.max(this._session.metrics.maxQueueDepth, this._queue.length);
    this._ensureWorker();
    await this._checkpoint();
  }

  _ensureWorker() {
    if (this._worker || this._finalized || this._session?.transcriptionPaused) return;
    this._worker = this._runWorker().finally(() => {
      this._worker = null;
      if (this._queue.length && !this._finalized) this._ensureWorker();
    });
  }

  async _runWorker() {
    while (this._queue.length) {
      if (this._session.transcriptionPaused) {
        this._session.metrics.queueDepth = this._queue.length;
        await this._checkpoint();
        return;
      }
      const descriptor = this._queue.shift();
      this._session.metrics.queueDepth = this._queue.length;
      await this._processChunk(descriptor);
    }
    this._queueWarning = false;
    this._session.metrics.queueDepth = 0;
    await this._checkpoint();
  }

  async _readChunk(descriptor) {
    const bytes = Buffer.allocUnsafe(descriptor.length);
    const handle = await open(descriptor.path, 'r');
    try {
      const { bytesRead } = await handle.read(bytes, 0, descriptor.length, descriptor.offset);
      if (bytesRead !== descriptor.length) throw new Error('Short read for persisted PCM chunk');
      return bytes;
    } finally {
      await handle.close();
    }
  }

  /**
   * Measure how loud the chunk is. Returns the peak sample as a 0..1 level;
   * the chunk counts as silent while that level stays under the threshold.
   */
  _isSilent(bytes) {
    let peak = 0;
    for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
      const sample = Math.abs(bytes.readInt16LE(offset));
      if (sample > peak) peak = sample;
    }
    return peak / 32768;
  }

  async _retry(operation) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= this.maxRetries || error?.retryable === false) throw error;
        this._session.metrics.retries += 1;
        await this._checkpoint();
        if (this.retryDelay) await sleep(this.retryDelay * (attempt + 1));
      }
    }
  }

  async _processChunk(descriptor) {
    const duplicateMix = this._trackMode === 'mix' && descriptor.source !== 'mix';
    const duplicateTracks = this._trackMode === 'separate' && descriptor.source === 'mix';
    if (duplicateMix || duplicateTracks) {
      this._session.metrics.suppressedChunks += 1;
      return;
    }
    const bytes = await this._readChunk(descriptor);
    const level = this._isSilent(bytes);
    if (level * 32768 <= this.energyThreshold) {
      // A real pause is a sentence boundary even when the ASR did not return
      // punctuation. Do not leave the previous caption open forever.
      await this._closeCaption(descriptor.source);
      this._session.metrics.skippedChunks += 1;
      return;
    }
    const context = {
      chunkId: descriptor.chunkId,
      sessionId: descriptor.sessionId,
      source: descriptor.source,
      timestamp: descriptor.timestamp,
      sampleRate: descriptor.sampleRate,
      channels: descriptor.channels,
      sourceLanguage: this._session.sourceLanguage,
      targetLanguage: this._session.targetLanguage,
      hotwords: this._session.hotwords || '',
      itn: this._session.itn !== false,
    };
    let text;
    try {
      text = callbackText(await this._retry(() => this.transcribe(bytes, context))).trim();
    } catch (error) {
      this._session.metrics.transcriptionFailures += 1;
      this._session.degraded = true;
      await this._emit('error', {
        code: 'transcription-failed', source: descriptor.source, timestamp: descriptor.timestamp,
        chunkId: descriptor.chunkId, detail: messageOf(error),
      });
      return;
    }
    this._session.metrics.transcribedChunks += 1;
    if (!text) return;
    await this._appendCaption(descriptor, text, level, context);
  }

  /** Append one ASR fragment to the current sentence and publish the whole line. */
  async _appendCaption(descriptor, text, level, context) {
    let line = this._captionLines.get(descriptor.source);
    if (!line) {
      line = {
        id: descriptor.chunkId,
        text: '',
        timestamp: descriptor.timestamp,
        offset: descriptor.offset,
        length: descriptor.length,
      };
      this._captionLines.set(descriptor.source, line);
    }
    const needsSpace = /^[A-Za-z0-9]/.test(text) && /[A-Za-z0-9]$/.test(line.text);
    line.text += (needsSpace ? ' ' : '') + text;
    line.length = descriptor.offset + descriptor.length - line.offset;
    const trimmed = line.text.trim();
    const punctuation = /[.!?。！？…]["'”’）)]?$/.test(trimmed);
    const tooLong = trimmed.length >= 120 || descriptor.timestamp - line.timestamp >= 25000;
    const closed = punctuation || tooLong;
    const captionDescriptor = {
      ...descriptor,
      chunkId: line.id,
      timestamp: line.timestamp,
      offset: line.offset,
      length: line.length,
    };
    await this._emit('transcript', {
      source: descriptor.source,
      text: line.text,
      timestamp: line.timestamp,
      chunkId: line.id,
      offset: line.offset,
      length: line.length,
      pass: 'provisional',
      partial: !closed,
      level,
    });
    if (typeof this.translate === 'function' || typeof this.translateStream === 'function') {
      this._scheduleTranslation(line.text, { ...context, chunkId: line.id }, captionDescriptor);
    }
    if (closed) this._captionLines.delete(descriptor.source);
  }

  /** Close an unfinished sentence without inventing any new text. */
  async _closeCaption(source) {
    const line = this._captionLines.get(source);
    if (!line) return;
    this._captionLines.delete(source);
    await this._emit('transcript', {
      source,
      text: line.text,
      timestamp: line.timestamp,
      chunkId: line.id,
      offset: line.offset,
      length: line.length,
      pass: 'provisional',
      partial: false,
    });
  }

  async _flushCaptions() {
    for (const source of [...this._captionLines.keys()]) {
      await this._closeCaption(source);
    }
  }

  /** Queue a finished chunk for translation. */
  _scheduleTranslation(text, context, descriptor) {
    // A sentence may be translated several times while it grows. Only the
    // newest version may reach the reader; an older prefix must never win.
    for (const task of this._translationQueue) {
      if (task.descriptor.chunkId === descriptor.chunkId && task.state !== 'done') {
        task.superseded = true;
      }
    }
    this._translationQueue.push({ text, context, descriptor, state: 'pending', payload: null, superseded: false });
    this._pumpTranslations();
  }

  /** Start as many queued translations as the limit allows, oldest first. */
  _pumpTranslations() {
    for (const task of this._translationQueue) {
      if (this._activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) break;
      if (task.state !== 'pending') continue;
      task.state = 'running';
      this._activeTranslations += 1;
      const finish = () => {
        task.state = 'done';
        this._activeTranslations -= 1;
        this._drainTranslations();
        this._pumpTranslations();
      };
      void this._translateChunk(task).then(
        (payload) => { task.payload = payload; finish(); },
        () => { task.payload = null; finish(); },
      );
    }
    this._drainTranslations();
  }

  /** Publish finished translations in the order their chunks arrived. */
  _drainTranslations() {
    this._translationDrain = this._translationDrain.catch(() => {}).then(async () => {
      while (this._translationQueue.length && this._translationQueue[0].state === 'done') {
        const task = this._translationQueue.shift();
        if (task.payload) await this._emit(task.payload.type, task.payload.fields);
      }
    });
    return this._translationDrain;
  }

  /** Wait until every queued translation has been published. */
  async _awaitTranslations() {
    while (this._translationQueue.length || this._activeTranslations > 0) {
      await this._translationDrain.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await this._translationDrain.catch(() => {});
  }

  /** Translate one finished chunk and hand the result back for publishing. */
  async _translateChunk(task) {
    const { text, context, descriptor } = task;
    // While the model writes, the caption grows: the reader sees the first
    // words instead of waiting for the whole sentence.
    let lastPartial = 0;
    const emitPartial = (partial) => {
      if (task.superseded) return;
      const now = Date.now();
      if (now - lastPartial < 120) return;
      lastPartial = now;
      void this._emit('translation', {
        source: descriptor.source,
        text: partial,
        translation: partial,
        transcript: text,
        timestamp: descriptor.timestamp,
        chunkId: descriptor.chunkId,
        partial: true,
      });
    };
    try {
      const translated = typeof this.translateStream === 'function'
        ? callbackText(await this._retry(() => this.translateStream(text, context, emitPartial))).trim()
        : callbackText(await this._retry(() => this.translate(text, context))).trim();
      if (task.superseded) return null;
      this._session.metrics.translatedChunks += 1;
      if (!translated) return null;
      return {
        type: 'translation',
        fields: {
          source: descriptor.source,
          text: translated,
          translation: translated,
          transcript: text,
          timestamp: descriptor.timestamp,
          chunkId: descriptor.chunkId,
        },
      };
    } catch (error) {
      this._session.metrics.translationFailures += 1;
      this._session.degraded = true;
      return {
        type: 'error',
        fields: {
          code: 'translation-failed', source: descriptor.source, timestamp: descriptor.timestamp,
          chunkId: descriptor.chunkId, detail: messageOf(error),
        },
      };
    }
  }

  /** Record the final (pass 2) transcript that replaces the provisional chunk captions. */
  async applyFinalTranscript(segments = [], meta = {}) {
    if (!this._session) throw new Error('No active realtime session');
    const list = Array.isArray(segments) ? segments : [];
    const text = String(meta.text || list.map((segment) => segment.text || '').join('\n'));
    await this._emit('transcript-final', {
      source: meta.source || '',
      text,
      segments: list.map((segment) => ({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: segment.text || '',
        speaker: segment.speaker || '',
      })),
      timestamp: Date.now(),
      detail: meta.detail || 'final',
    });
    return this._snapshot();
  }

  /** Persist a note or flag marker into the session journal. */
  async mark(id = this._session?.id, payload = {}) {
    if (!this._session || this._session.id !== id) throw new Error('Unknown realtime session');
    const kind = payload.kind === 'flag' ? 'flag' : 'note';
    const text = String(payload.text || '').trim();
    await this._emit('marker', {
      kind,
      text,
      detail: kind,
      timestamp: Number(payload.timestamp) || Date.now(),
      source: '',
    });
    return this._snapshot();
  }

  async _finalize(status) {
    if (this._finalized || !this._session) return;
    this._finalized = true;
    // The last sentence may have no punctuation; ending the meeting closes it.
    await this._flushCaptions();
    await this._awaitTranslations();
    this._session.captureAttached = false;
    this._session.status = status;
    this._session.endedAt = new Date().toISOString();
    this._session.durationSeconds = this._durationSeconds(this._session);
    await this._emit('status', { detail: status });
    await this._checkpointChain;
    if (this._session.incognito && this._sessionDir) {
      await rm(this._sessionDir, { recursive: true, force: true }).catch(() => {});
      this._sessionDir = null;
    }
  }
}

export default RealtimeManager;
