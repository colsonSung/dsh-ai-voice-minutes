import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pcmToWav } from './live.js';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runProcess = promisify(execFile);
const DEFAULT_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin';
const WHISPER_CPP_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const SENSE_VOICE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2';
const SENSE_VOICE_ARCHIVE_ROOT = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const FUN_ASR_BASE = 'https://hf-mirror.com/FunAudioLLM/Fun-ASR-Nano-2512/resolve/main';
const FUN_ASR_FILES = [
  'config.yaml',
  'configuration.json',
  'multilingual.tiktoken',
  'model.pt',
  'Qwen3-0.6B/config.json',
  'Qwen3-0.6B/generation_config.json',
  'Qwen3-0.6B/merges.txt',
  'Qwen3-0.6B/tokenizer.json',
  'Qwen3-0.6B/tokenizer_config.json',
  'Qwen3-0.6B/vocab.json',
].map((name) => ({
  name,
  url: `${FUN_ASR_BASE}/${name.split('/').map(encodeURIComponent).join('/')}`,
  ...(name === 'model.pt' ? { sizeBytes: 1_880_000_000, sizeLabel: '1.88 GB' } : {}),
}));

/** Downloadable ASR models; native entries always live below native/asr/models. */
export const ASR_MODEL_CATALOG = [
  { id: 'ggml-tiny.bin', label: 'Tiny', sizeLabel: '75 MB', sizeBytes: 78643200 },
  { id: 'ggml-base.bin', label: 'Base', sizeLabel: '142 MB', sizeBytes: 148897792 },
  { id: 'ggml-small.bin', label: 'Small', sizeLabel: '466 MB', sizeBytes: 488636416 },
  { id: 'ggml-medium.bin', label: 'Medium', sizeLabel: '1.5 GB', sizeBytes: 1610612736 },
  { id: 'ggml-large-v3.bin', label: 'Large v3', sizeLabel: '2.9 GB', sizeBytes: 3115036672 },
  { id: 'ggml-large-v3-q5_0.bin', label: 'Large v3 Q5', sizeLabel: '1.0 GB', sizeBytes: 1080525312 },
  { id: 'ggml-large-v3-turbo.bin', label: 'Large v3 Turbo', sizeLabel: '1.6 GB', sizeBytes: 1703240704 },
  { id: 'ggml-large-v3-turbo-q5_0.bin', label: 'Large v3 Turbo Q5', sizeLabel: '547 MB', sizeBytes: 573645568 },
].map((entry) => ({ ...entry, backend: 'whispercpp', role: 'asr', capability: 'live', kind: 'file', url: WHISPER_CPP_BASE + entry.id })).concat([
  {
    id: 'sensevoice',
    label: 'SenseVoice',
    backend: 'sensevoice',
    role: 'asr',
    capability: 'live',
    kind: 'tar.bz2',
    sizeLabel: '1.05 GB',
    sizeBytes: 1047870769,
    url: SENSE_VOICE_URL,
    // The recognizer only loads the int8 model and the tokens, so those are
    // what decides whether SenseVoice is ready. The full model is optional.
    files: ['model.int8.onnx', 'tokens.txt'].map((name) => ({ name })),
  },
  {
    id: 'fun-asr-nano',
    label: 'Fun-ASR-Nano',
    backend: 'funasr',
    role: 'asr',
    // The refinement pass, not a caption model: /finalize always uses it.
    capability: 'refine',
    kind: 'files',
    sizeLabel: '约 1.9 GB',
    sizeBytes: 2000000000,
    files: FUN_ASR_FILES,
  },
  {
    id: 'ecapa',
    label: 'ECAPA 说话人模型',
    backend: 'diarize',
    role: 'diarize',
    capability: 'diarize',
    kind: 'files',
    sizeLabel: '85 MB',
    sizeBytes: 89000000,
    files: [
      { name: 'classifier.ckpt' },
      { name: 'embedding_model.ckpt' },
      { name: 'hyperparams.yaml' },
      { name: 'label_encoder.txt' },
      { name: 'mean_var_norm_emb.ckpt' },
    ],
  },
]);

export const DEFAULT_ASR_MODEL_DIR = fileURLToPath(new URL('./native/asr/models/', import.meta.url));
/** Backends that can serve live captions; Fun-ASR is refinement only. */
export const LIVE_BACKENDS = ['whispercpp', 'sensevoice'];

export const DEFAULT_ASR_LAUNCHER = fileURLToPath(new URL('./native/asr/local_services.py', import.meta.url));
export const DEFAULT_FUN_ASR_PYTHON = fileURLToPath(new URL('./native/asr/runtime/venv-funasr/bin/python', import.meta.url));

function errorOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fileSize(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function directorySize(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const child = join(path, entry.name);
      total += entry.isDirectory() ? await directorySize(child) : await fileSize(child);
    }
    return total;
  } catch {
    return 0;
  }
}

export class AsrAdmin {
  constructor(options = {}) {
    this.configSource = options.config || {};
    this.run = options.run || runProcess;
  }

  /**
   * The live settings. `options.config` may be a plain object or a function that
   * returns the current settings, so the admin never keeps a stale snapshot of
   * a config object that the service replaces on every write.
   */
  get config() {
    return typeof this.configSource === 'function' ? (this.configSource() || {}) : this.configSource;
  }

  set config(value) {
    this.configSource = value;
  }

  modelDir() {
    return this.config.asrModelDir || DEFAULT_ASR_MODEL_DIR;
  }

  launcher() {
    return this.config.asrLauncher || DEFAULT_ASR_LAUNCHER;
  }

  /**
   * The backend that serves **live captions**.
   *
   * Fun-ASR-Nano is not one of them, on purpose: it is the pass-2 refinement
   * model (`/finalize` always uses it, whatever this returns), and as a live
   * backend it costs about fifteen seconds per request just to reload its
   * weights. A 3-second caption chunk measured 28s on Fun-ASR against 0.5s on
   * SenseVoice, which is the difference between "subtitles" and "nothing".
   */
  backend() {
    const configured = this.config.asrBackend || 'whispercpp';
    // A saved `funasr` predates this split; treat it as "the refinement model
    // is on, but live captions need a fast one".
    if (configured === 'funasr') return 'sensevoice';
    if (!LIVE_BACKENDS.includes(configured)) {
      throw new Error('未知 ASR 后端：' + configured);
    }
    return configured;
  }

  modelPaths() {
    return {
      whispercpp: this.config.whisperCppModel || join(this.modelDir(), 'ggml-large-v3.bin'),
      sensevoice: this.config.senseVoiceDir || join(this.modelDir(), 'sensevoice'),
      funasr: this.config.funAsrDir || join(this.modelDir(), 'fun-asr-nano'),
    };
  }

  startArguments() {
    const backend = this.backend();
    const paths = this.modelPaths();
    const args = [this.launcher(), 'start', 'asr', '--backend', backend];
    if (backend === 'whispercpp' && this.config.whisperCppModel) {
      args.push('--cpp-model', paths.whispercpp);
    } else if (backend === 'sensevoice') {
      args.push('--sense-voice-dir', paths.sensevoice);
    }
    // pass 2 精修始终可用：无论 pass 1 用哪个后端，都把 Fun-ASR worker 参数传下去，
    // 这样 /finalize 可以随时调用 Fun-ASR-Nano 做最终文本精修。
    args.push(
      '--fun-asr-dir', paths.funasr,
      '--fun-asr-python', this.config.funAsrPython || DEFAULT_FUN_ASR_PYTHON,
    );
    args.push(
      '--diarize', '--speakers', '0', '--prompt', '',
      '--threshold', String(this.config.asrDiarizeThreshold ?? 0.82),
    );
    return args;
  }

  async probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(joinUrl(this.config.asrBaseUrl, '/health'), { signal: controller.signal });
      if (!response.ok) return { online: false, health: { status: 'error', httpStatus: response.status } };
      return { online: true, health: await response.json() };
    } catch (error) {
      return { online: false, health: { status: 'offline', detail: errorOf(error) } };
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    const [probe, catalog] = await Promise.all([this.probe(), this.catalog()]);
    const models = catalog.entries.filter((entry) => entry.downloaded);
    const live = catalog.entries.find((entry) => entry.id === catalog.activeId)
      || catalog.entries.find((entry) => entry.capability === 'live' && entry.downloaded)
      || null;
    const refine = catalog.entries.find((entry) => entry.capability === 'refine') || null;
    return {
      catalog,
      // Two roles, two answers. The panel shows them separately because they
      // have different jobs and different failure modes: a slow live model
      // costs captions, a missing refinement model costs the final text.
      live: live ? {
        id: live.id, label: live.label || live.id, backend: live.backend,
        downloaded: Boolean(live.downloaded), size: live.actualSize || 0,
      } : null,
      refine: refine ? {
        id: refine.id, label: refine.label || refine.id, backend: refine.backend,
        downloaded: Boolean(refine.downloaded), size: refine.actualSize || 0,
        // /finalize is unavailable without it, and it is independent of the
        // live backend by design.
        ready: Boolean(refine.downloaded),
      } : null,
      online: probe.online,
      endpoint: this.config.asrBaseUrl,
      health: probe.health,
      models,
      modelDir: this.modelDir(),
      backend: this.backend(),
      asrBackend: this.backend(),
      modelPaths: this.modelPaths(),
      funAsrPython: this.config.funAsrPython || DEFAULT_FUN_ASR_PYTHON,
      whisperCppModel: this.config.whisperCppModel || '',
      launcher: this.launcher(),
      autoStart: Boolean(this.config.asrAutoStart),
    };
  }

  async waitFor(online, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = await this.probe();
      if (probe.online === online) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(online ? 'ASR service did not become ready' : 'ASR service did not stop');
  }

  async start() {
    if ((await this.probe()).online) return { ...(await this.status()), started: false };
    try {
      await this.run(this.config.asrPython || 'python3', this.startArguments(), { timeout: 30000 });
    } catch (error) {
      throw new Error('本地 ASR 启动失败：' + errorOf(error) + '（请检查设置中的启动脚本与模型目录）');
    }
    try {
      await this.waitFor(true);
    } catch (error) {
      throw new Error('本地 ASR 启动后未就绪：' + errorOf(error) + '（请查看 ' + this.modelDir().replace(/\/models\/?$/, '/runtime/logs') + ' 下的日志）');
    }
    return { ...(await this.status()), started: true };
  }

  async stop() {
    await this.run(this.config.asrPython || 'python3', [this.launcher(), 'stop', 'asr'], { timeout: 15000 });
    await this.waitFor(false);
    return { ...(await this.status()), stopped: true };
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  /**
   * Load the refinement model ahead of time.
   *
   * The Fun-ASR worker reloads its weights on a fresh process, so the first
   * `/finalize` of the day pays about fifteen seconds. Warming it moves that
   * cost off the end of a meeting.
   */
  async warmRefiner() {
    const base = String(this.config.asrBaseUrl || '').replace(/\/v1\/?$/, '');
    const started = Date.now();
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return { ok: false, detail: 'ASR 服务未就绪（HTTP ' + response.status + '）' };
    } catch (error) {
      return { ok: false, detail: 'ASR 服务未就绪：' + errorOf(error) };
    }
    try {
      // One second of silence is enough to make the worker build its model.
      const silence = Buffer.alloc(16000 * 2);
      const wav = pcmToWav(silence);
      const boundary = '----ai-minutes-warmup-' + Date.now();
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="track"\r\n\r\nmic\r\n'),
        Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="language"\r\n\r\nauto\r\n'),
        Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="warmup.wav"\r\nContent-Type: audio/wav\r\n\r\n'),
        wav,
        Buffer.from('\r\n--' + boundary + '--\r\n'),
      ]);
      const response = await fetch(base + '/finalize', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=' + boundary, 'content-length': String(body.length) },
        body,
        signal: AbortSignal.timeout(180000),
      });
      const text = await response.text();
      return {
        ok: response.ok,
        elapsed: (Date.now() - started) / 1000,
        detail: response.ok ? '' : 'HTTP ' + response.status + ' ' + text.slice(0, 120),
      };
    } catch (error) {
      return { ok: false, detail: errorOf(error) };
    }
  }

  /** Resolve which catalog entry is currently in use for live captions. */
  activeModelId(downloadedIds = []) {
    if (this.backend() === 'sensevoice') return 'sensevoice';
    const configured = this.config.whisperCppModel ? this.config.whisperCppModel.split('/').pop() : '';
    if (configured) return configured;
    if (downloadedIds.includes('ggml-large-v3.bin')) return 'ggml-large-v3.bin';
    if (downloadedIds.includes('ggml-large-v3-q5_0.bin')) return 'ggml-large-v3-q5_0.bin';
    return downloadedIds[0] || '';
  }

  async nativeEntryState(entry) {
    const path = join(this.modelDir(), entry.id);
    const required = entry.files.map((file) => file.name);
    const sizes = await Promise.all(required.map((name) => fileSize(join(path, name))));
    return {
      path,
      downloaded: sizes.every((size) => size > 0),
      actualSize: await directorySize(path),
    };
  }

  /** Merge the downloadable catalog with what is on disk and what is active. */
  async catalog() {
    const models = await this.models();
    const byName = new Map(models.map((model) => [model.name, model]));
    const downloadedIds = models.map((model) => model.name);
    const activeId = this.activeModelId(downloadedIds);
    return {
      activeId,
      modelDir: this.modelDir(),
      entries: await Promise.all(ASR_MODEL_CATALOG.map(async (entry) => {
        if (entry.kind !== 'file') {
          const state = await this.nativeEntryState(entry);
          return {
            ...entry,
            ...state,
            active: entry.id === activeId,
            // Fun-ASR is the pass-2 refiner. It is always wired, so it is not a
            // live backend the reader can switch to.
            refine: entry.capability === 'refine',
            selectable: entry.capability === 'live',
            downloadable: true,
            deletable: true,
          };
        }
        return {
          ...entry,
          downloaded: byName.has(entry.id),
          path: byName.get(entry.id)?.path || join(this.modelDir(), entry.id),
          actualSize: byName.get(entry.id)?.size || 0,
          active: entry.id === activeId,
          refine: false,
          selectable: entry.capability === 'live',
          downloadable: true,
          deletable: true,
        };
      })),
    };
  }

  /** The settings patch that makes a catalog entry the model in use. */
  modelSettingsPatch(entry) {
    if (entry.backend === 'sensevoice') return { senseVoiceDir: entry.path, asrBackend: 'sensevoice' };
    if (entry.backend === 'funasr') return { funAsrDir: entry.path, asrBackend: 'funasr' };
    return { whisperCppModel: entry.path, asrBackend: 'whispercpp' };
  }

  /**
   * Resolve the model the user picked. Every backend keeps its own setting, so
   * the id decides which one moves instead of always writing whisperCppModel.
   */
  async selectModel(payload = {}) {
    const catalog = await this.catalog();
    const id = String(payload.id || '');
    const path = String(payload.path || '');
    const entry = id
      ? catalog.entries.find((item) => item.id === id)
      : catalog.entries.find((item) => item.path === path || item.id === path.split('/').pop());
    if (!entry) return { ok: false, code: 'unknown', error: '未知模型：' + (id || path) };
    if (entry.role !== 'asr') return { ok: false, code: 'not-selectable', error: '该模型不是转写模型，无法切换' };
    if (!entry.downloaded) return { ok: false, code: 'missing', error: '模型尚未下载：' + entry.id };
    return { ok: true, entry, patch: this.modelSettingsPatch(entry) };
  }

  /** Delete a downloaded model unless it is the one in use. */
  async deleteModel(payload = {}) {
    const id = String(payload.id || payload.name || '');
    if (!id || !ASR_MODEL_CATALOG.some((entry) => entry.id === id)) return { ok: false, error: '未知模型：' + id };
    const catalog = await this.catalog();
    if (catalog.activeId === id) return { ok: false, error: '该模型正在使用中，请先切换到其他模型' };
    const entry = catalog.entries.find((item) => item.id === id);
    if (!entry?.downloaded) return { ok: false, error: '该模型尚未下载' };
    await rm(entry.path, { recursive: true, force: true });
    return { ok: true, catalog: await this.catalog() };
  }

  async models() {
    let names;
    try {
      names = await readdir(this.modelDir());
    } catch {
      return [];
    }
    const models = [];
    for (const name of names.filter((name) => name.endsWith('.bin')).sort()) {
      const path = join(this.modelDir(), name);
      const info = await stat(path);
      models.push({ name, path, size: info.size, mtimeMs: info.mtimeMs, selected: this.config.whisperCppModel === path });
    }
    return models;
  }

  async downloadModel(options = {}) {
    const catalogEntry = options.id ? ASR_MODEL_CATALOG.find((entry) => entry.id === options.id) : null;
    if (options.id && !catalogEntry) throw new Error('未知模型：' + options.id);
    if (catalogEntry?.kind === 'files') return this.downloadFunAsr(catalogEntry, options);
    if (catalogEntry?.kind === 'tar.bz2') return this.downloadSenseVoice(catalogEntry, options);

    const url = options.url || catalogEntry?.url || DEFAULT_MODEL_URL;
    const filename = basename(options.filename || catalogEntry?.id || 'ggml-large-v3.bin');
    await mkdir(this.modelDir(), { recursive: true });
    const path = join(this.modelDir(), filename);
    if (await fileSize(path)) return { downloaded: false, path };
    const temporary = path + '.part';
    try {
      await downloadToFile(url, temporary);
      await rename(temporary, path);
      return { downloaded: true, path };
    } catch (error) {
      throw new Error('Model download failed (partial file retained for resume): ' + errorOf(error));
    }
  }

  async downloadFunAsr(entry, options) {
    const target = join(this.modelDir(), 'fun-asr-nano');
    let changed = false;
    for (const file of entry.files) {
      const destination = join(target, file.name);
      await mkdir(dirname(destination), { recursive: true });
      if (await fileSize(destination)) continue;
      const temporary = destination + '.part';
      const url = options.baseUrl
        ? String(options.baseUrl).replace(/\/+$/, '') + '/' + file.name.split('/').map(encodeURIComponent).join('/')
        : file.url;
      try {
        await downloadToFile(url, temporary);
        await rename(temporary, destination);
        changed = true;
      } catch (error) {
        throw new Error(`Fun-ASR-Nano download failed at ${file.name}; partial files retained: ${errorOf(error)}`);
      }
    }
    return { downloaded: changed, path: target };
  }

  async downloadSenseVoice(entry, options) {
    const target = join(this.modelDir(), 'sensevoice');
    const state = await this.nativeEntryState(entry);
    if (state.downloaded) return { downloaded: false, path: target };
    await mkdir(this.modelDir(), { recursive: true });
    const temporary = join(this.modelDir(), 'sensevoice.tar.bz2.part');
    const extract = join(this.modelDir(), '.sensevoice-extract');
    try {
      await downloadToFile(options.url || entry.url, temporary);
      await rm(extract, { recursive: true, force: true });
      await mkdir(extract, { recursive: true });
      await this.run('tar', ['-xjf', temporary, '-C', extract], { timeout: 120000 });
      await rm(target, { recursive: true, force: true });
      await rename(join(extract, SENSE_VOICE_ARCHIVE_ROOT), target);
      await rm(extract, { recursive: true, force: true });
      await rm(temporary, { force: true });
      return { downloaded: true, path: target };
    } catch (error) {
      throw new Error('SenseVoice download/extract failed; partial archive retained: ' + errorOf(error));
    }
  }
}

function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path;
}

async function downloadToFile(url, destination, redirects = 0) {
  if (redirects > 3) throw new Error('Too many redirects');
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const offset = await fileSize(destination);
  const headers = offset > 0 ? { range: `bytes=${offset}-` } : {};
  await new Promise((resolve, reject) => {
    const request = transport(target, { headers }, async (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        try {
          await downloadToFile(new URL(response.headers.location, target), destination, redirects + 1);
          resolve();
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (response.statusCode === 416) {
        response.resume();
        const match = String(response.headers['content-range'] || '').match(/bytes \*\/(\d+)/);
        if (match && Number(match[1]) === offset) resolve();
        else reject(new Error('HTTP 416 (partial file length does not match remote file)'));
        return;
      }
      if (![200, 206].includes(response.statusCode)) {
        response.resume();
        reject(new Error('HTTP ' + response.statusCode));
        return;
      }
      try {
        // A 200 response ignores Range and must restart rather than corrupt the partial file.
        const append = offset > 0 && response.statusCode === 206;
        await pipeline(response, createWriteStream(destination, { flags: append ? 'a' : 'w' }));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(new Error('Download timed out')));
    request.end();
  });
}
