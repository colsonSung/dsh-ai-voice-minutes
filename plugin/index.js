/**
 * Host half of the local AI Minutes plugin.
 *
 * Everything here stays on the machine: audio goes to the local ASR service,
 * summaries go to a local (or explicitly configured) chat endpoint, and the
 * meeting library is a folder of JSON files the user owns.
 *
 * The agent can drive the same capability through the commands registered
 * below, so the Chat surface and the panel share one implementation.
 */
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir, userInfo } from 'node:os';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createLiveManager, listLiveMeetings, liveMeetingFromStatus, pcmToWav } from './live.js';
import { DesktopOverlay, appearanceForTheme } from './overlay.js';
import { AsrAdmin, DEFAULT_ASR_LAUNCHER, DEFAULT_ASR_MODEL_DIR } from './asr-admin.js';

export { createCaptureStream, pcmToWav } from './live.js';

const run = promisify(execFile);

export const inject = ['commands', 'connection'];

/** The route the Client half posts to. */
export const ROUTE = '/api/ai-minutes';
/** The route that takes raw audio bytes, so a long recording never becomes a JSON string. */
export const AUDIO_ROUTE = '/api/ai-minutes/audio';
/** Stream the current PCM track as a WAV without loading it into memory. */
export const LIVE_AUDIO_ROUTE = '/api/ai-minutes/live-audio';
export const MEETING_AUDIO_ROUTE = '/api/ai-minutes/meeting-audio';

const T2S = (() => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./data/t2s.json', import.meta.url), 'utf8'));
    return { map: parsed.map || parsed, maxLen: Number(parsed.maxLen) || 1 };
  } catch {
    return { map: {}, maxLen: 1 };
  }
})();

const LIVE_SUMMARY_MIN_CHARS = 60;
const LIVE_SUMMARY_GROWTH = 0.25;

const BUILTIN_TEMPLATES = [
  { id: 'intelligent-slicing', name: 'Intelligent Slicing', description: 'Intelligent segmentation combining, quickly summarises each topic', vip: true, builtin: true },
  { id: 'visual-summary', name: 'Visual Summary', description: 'Combines text and visuals to capture the meeting highlights', vip: true, builtin: true },
  { id: 'classic', name: 'Classic', description: 'A clear, professional report template for review', vip: true, builtin: true },
  { id: 'meeting-minutes', name: 'Meeting Minutes', description: 'Summarise the meeting with conclusions and action items', vip: false, builtin: true },
];

const TEMPLATE_PROMPTS = {
  'intelligent-slicing': '按议题智能切分：每个议题给出摘要、关键观点、结论与待办，并保留时间顺序。',
  'visual-summary': '以要点式摘要输出：先给一句话结论，再列出关键要点、决策与风险，条目化、便于速读。',
  'classic': '输出正式会议纪要：包含背景、讨论要点、结论、决策与待办事项，待办需写明负责人和截止时间。',
  'meeting-minutes': '输出会议纪要：包含会议摘要、关键结论、行动项（负责人与时间）与待确认事项。',
};

const TEMPLATE_SCHEMAS = {
  'intelligent-slicing': {
    summary: '一句话结论（不超过60字）',
    topics: [{ title: '议题标题', start: 0, end: 0, summary: '本段讨论了什么', decisions: ['达成的结论'] }],
    chapters: [{ start: 0, end: 0, title: '章节标题', summary: '章节摘要' }],
    viewpoints: [{ theme: '主题分类', cards: [{ stance: '立场', detail: '论据', risk: '风险' }] }],
    decisions: [{ id: 'd1', title: '决策标题', detail: '决策内容与依据', type: 'accept|reject|defer|clarify', owner: '责任人', due: '时间要求' }],
    todos: [{ text: '待办事项', owner: '责任人', due: '时间要求' }],
    disputes: [{ text: '未达成一致的争议点' }],
    risks: [{ text: '暴露的风险' }],
  },
  'visual-summary': {
    summary: '一句话结论（不超过60字）',
    highlights: [{ title: '要点标题', detail: '要点说明' }],
    topics: [{ title: '议题标题', start: 0, end: 0, summary: '本段讨论了什么' }],
    decisions: [{ id: 'd1', title: '决策标题', detail: '决策内容与依据' }],
    risks: [{ text: '暴露的风险' }],
  },
  'classic': {
    summary: '会议概述（不超过60字）',
    background: '会议背景与目标',
    agenda: ['议题一', '议题二'],
    discussion: [{ title: '讨论要点', summary: '讨论内容与结论' }],
    conclusion: '会议结论',
    decisions: [{ id: 'd1', title: '决策标题', detail: '决策内容与依据' }],
    todos: [{ text: '待办事项', owner: '责任人', due: '截止时间' }],
  },
  'meeting-minutes': {
    summary: '会议摘要（不超过60字）',
    conclusions: ['关键结论一', '关键结论二'],
    actions: [{ text: '行动项', owner: '责任人', due: '完成时间' }],
    openItems: [{ text: '待确认事项', owner: '责任人' }],
    decisions: [{ id: 'd1', title: '决策标题', detail: '决策内容与依据' }],
  },
};

const DEFAULTS = {
  asrProvider: 'local',
  asrAutoStart: false,
  liveChunkSeconds: 3,
  asrDiarizeThreshold: 0.82,
  voiceMatchThreshold: 0.5,
  asrPython: 'python3',
  asrLauncher: DEFAULT_ASR_LAUNCHER,
  asrModelDir: DEFAULT_ASR_MODEL_DIR,
  siliconflowBaseUrl: 'https://api.siliconflow.cn/v1',
  siliconflowModel: 'XingChenAGI/XingChenGSR-V1.0',
  asrBaseUrl: 'http://127.0.0.1:8010',
  asrPath: '/v1/audio/transcriptions',
  asrModel: 'base',
  // Minutes and Q&A are local-first too. Hy-MT is translation-only, so the
  // general Qwen model handles structured minutes and meeting questions.
  llmProvider: 'lmstudio',
  llmBaseUrl: 'http://127.0.0.1:6121/v1',
  llmPath: '/chat/completions',
  llmModel: 'qwen3.5-9b-mtp',
  llmTemperature: 0.2,
  llmMaxTokens: 0,
  llmReasoningEffort: 'none',
  // The minutes model can fall back to a second endpoint, so a cloud outage
  // does not cost the meeting its minutes.
  llmFallbackEnabled: false,
  llmFallbackProvider: 'lmstudio',
  llmFallbackBaseUrl: 'http://127.0.0.1:6121/v1',
  llmFallbackPath: '/chat/completions',
  llmFallbackModel: '',
  llmFallbackReasoningEffort: 'none',
  // The local model speaks first: no network round trip, so the caption lands
  // as fast as the machine can write it. The cloud model is the fallback.
  translationProvider: 'lmstudio',
  translationBaseUrl: 'http://127.0.0.1:6121/v1',
  translationPath: '/chat/completions',
  translationModel: 'hy-mt2-7b',
  translationApiKey: '',
  translationFallbackEnabled: true,
  translationFallbackProvider: 'minimax',
  translationFallbackBaseUrl: 'https://api.minimaxi.com/v1',
  translationFallbackPath: '/chat/completions',
  translationFallbackModel: 'MiniMax-M3.1-Flash',
  translationTemperature: 0.1,
  translationMaxTokens: 768,
  translationReasoningEffort: '',
  translationFallbackReasoningEffort: '',
  asrBackend: 'whispercpp',
  hotwords: '',
  asrLanguage: 'auto',
  translationPromptMode: 'auto',
  translationGlossary: '',
  apiKey: '',
  language: 'zh',
  overlayBackground: '#f6f6f7',
  overlayText: '#1c1c1e',
  overlayOpacity: 1,
  overlayCompact: true,
  dataDir: join(homedir(), '.ai-minutes'),
};

/** The languages a live meeting can be translated into. */
const LIVE_TARGET_LANGUAGES = ['zh', 'zh-Hant', 'yue', 'en', 'ja', 'ko', 'th', 'id'];

/**
 * A line of punctuation or a single character is noise, not content, so it
 * never reaches the summarizer.
 */
function isMeaningfulLine(value) {
  const text = String(value || '').trim();
  if (text.length < 2) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Pull the JSON object out of a model answer, whatever fences or prose
 * surround it. Returns null when nothing parses.
 */
function parseMinutesJson(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The overlay look, in the shape the native window expects on the wire.
 *
 * The window follows the host theme: the built-in colours are the ones that
 * belong to the theme, and only a colour the reader picked by hand replaces
 * them.
 */
function overlayAppearance(settings = {}, theme = 'light') {
  const base = appearanceForTheme(theme);
  const opacity = Number(settings.overlayOpacity);
  const background = String(settings.overlayBackground || '');
  const text = String(settings.overlayText || '');
  return {
    background: background && background !== DEFAULTS.overlayBackground ? background : base.background,
    text: text && text !== DEFAULTS.overlayText ? text : base.text,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : DEFAULTS.overlayOpacity,
    compact: settings.overlayCompact !== false,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function joinUrl(base, path) {
  const left = String(base || '').replace(/\/+$/, '');
  const right = String(path || '');
  return left + (right.startsWith('/') ? right : '/' + right);
}

const HYMT_LANGUAGE_NAMES_ZH = {
  zh: '简体中文', 'zh-Hant': '繁體中文', yue: '粵語', en: 'English', ja: '日本語',
  ko: '한국어', th: 'ภาษาไทย', id: 'Bahasa Indonesia',
};

const HYMT_LANGUAGE_NAMES_EN = {
  zh: 'Chinese (Simplified)', 'zh-Hant': 'Traditional Chinese', yue: 'Cantonese', en: 'English',
  ja: 'Japanese', ko: 'Korean', th: 'Thai', id: 'Indonesian',
};

const TARGET_LANGUAGES = {
  zh: 'Chinese (zh-Hans)',
  'zh-Hant': 'Traditional Chinese (zh-Hant)',
  yue: 'Cantonese (yue)',
  en: 'English (en)',
  ja: 'Japanese (ja)',
  ko: 'Korean (ko)',
  th: 'Thai (th)',
  id: 'Indonesian (id)',
};

function averageVector(vectors) {
  const usable = (vectors || []).filter((value) => Array.isArray(value) && value.length);
  if (!usable.length) return [];
  const length = usable[0].length;
  const sums = new Array(length).fill(0);
  for (const vector of usable) {
    for (let index = 0; index < length; index += 1) sums[index] += Number(vector[index]) || 0;
  }
  const norm = Math.sqrt(sums.reduce((total, value) => total + value * value, 0));
  return norm > 1e-9 ? sums.map((value) => Number((value / norm).toFixed(6))) : sums;
}

function voiceProfileId(embedding) {
  const digest = createHash('sha1').update((embedding || []).map((value) => Number(value).toFixed(4)).join(',')).digest('hex');
  return 'voice-' + digest.slice(0, 12);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function audioContentType(filename) {
  const extension = String(filename).split('.').pop()?.toLowerCase();
  return {
    m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
    ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
  }[extension] || 'application/octet-stream';
}

/** The download name for a requested file, when the caller asked to save it. */
function downloadName(request, filename) {
  const url = new URL(request.url, 'http://localhost');
  if (url.searchParams.get('download') !== '1') return '';
  return String(filename || 'audio').replace(/["\r\n]/g, '_');
}

/**
 * Serve an audio file with Range support, so the browser can seek inside it
 * instead of downloading the whole recording before the timeline moves.
 * `stream(from, to)` returns the bytes of the requested range.
 */
/**
 * Mix the microphone and system tracks sample by sample. The longer track
 * wins the length; the shorter one contributes silence after it ends. Samples
 * are averaged so the mixed file does not clip.
 */
function mixedPcmStream(leftPath, rightPath, { start = 0, end = -1 } = {}) {
  return Readable.from((async function* () {
    const handles = [];
    try {
      for (const path of [leftPath, rightPath].filter(Boolean)) {
        handles.push(await open(path, 'r'));
      }
      if (!handles.length) return;
      const sizes = await Promise.all(handles.map((handle) => handle.stat()));
      const longest = Math.max(...sizes.map((info) => info.size));
      if (!longest) return;
      const finish = end < 0 ? longest - 1 : Math.min(end, longest - 1);
      const readStart = start - (start % 2);
      const readEnd = Math.min(longest - 1, finish + (finish % 2 ? 1 : 0));
      let offset = readStart;
      while (offset <= readEnd) {
        const length = Math.min(65536, readEnd - offset + 1);
        const channels = [];
        for (const handle of handles) {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          if (bytesRead < length) buffer.fill(0, bytesRead);
          channels.push(buffer);
        }
        const mixed = Buffer.alloc(length);
        for (let index = 0; index + 1 < length; index += 2) {
          const sum = channels.reduce((total, buffer) => total + buffer.readInt16LE(index), 0);
          const value = Math.round(sum / channels.length);
          mixed.writeInt16LE(Math.max(-32768, Math.min(32767, value)), index);
        }
        const from = offset === readStart ? start - readStart : 0;
        const to = offset + length - 1 === readEnd ? finish - offset + 1 : length;
        yield mixed.subarray(from, to);
        offset += length;
      }
    } finally {
      await Promise.all(handles.map((handle) => handle.close().catch(() => {})));
    }
  })());
}

function audioRangeResponse(request, { stream, size, type, download }) {
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };
  if (download) headers['content-disposition'] = `attachment; filename="${download}"`;
  const range = request.headers.get('range');
  if (!range) {
    return new Response(Readable.toWeb(stream()), {
      status: 200,
      headers: { ...headers, 'content-length': String(size) },
    });
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);
  if (start === null) {
    // A suffix range asks for the last bytes of the file.
    start = Math.max(0, size - (end ?? 0));
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  }
  return new Response(Readable.toWeb(stream(start, end)), {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
    },
  });
}

/** Convert compressed audio to the WAV format required by local whisper.cpp builds. */
export async function convertAudioToWav(inputBytes, filename = 'meeting.audio') {
  const bytes = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    return { bytes, filename };
  }
  const directory = await mkdtemp(join(tmpdir(), 'ai-voice-minutes-audio-'));
  const extension = String(filename).split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'audio';
  const inputPath = join(directory, 'input.' + extension);
  const outputPath = join(directory, 'output.wav');
  try {
    await writeFile(inputPath, bytes);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath,
    ]);
    const base = String(filename).replace(/\.[^.]+$/, '') || 'meeting';
    return { bytes: await readFile(outputPath), filename: base + '.wav' };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Post multipart audio without the global fetch five-minute headers timeout. */
function postAudio(url, { bytes, filename, fields, headers = {} }) {
  const boundary = '----ai-voice-minutes-' + randomUUID();
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`));
  }
  const safeFilename = String(filename || 'meeting.wav').replace(/["\r\n]/g, '_');
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: audio/wav\r\n\r\n`));
  chunks.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(target, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=' + boundary,
        'content-length': body.length,
        ...headers,
      },
    }, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        text: Buffer.concat(responseChunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.setTimeout(30 * 60 * 1000, () => request.destroy(new Error('ASR request timed out after 30 minutes')));
    request.end(body);
  });
}

/** The API key lives in the OS keychain, never in the settings file. */
const KEYCHAIN_SERVICE = 'ai-minutes-api-key';
const SILICONFLOW_KEYCHAIN_SERVICE = 'siliconflow-api-key';
const TRANSLATION_KEYCHAIN_SERVICE = 'translation-api-key';

async function keychainWrite(secret, service = KEYCHAIN_SERVICE) {
  if (process.platform !== 'darwin') return false;
  try {
    await run('security', ['add-generic-password', '-a', userInfo().username, '-s', service, '-w', secret, '-U']);
    return true;
  } catch {
    return false;
  }
}

async function keychainRead(service = KEYCHAIN_SERVICE) {
  if (process.platform !== 'darwin') return '';
  try {
    const { stdout } = await run('security', ['find-generic-password', '-a', userInfo().username, '-s', service, '-w']);
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

function ok(result) {
  return { ok: true, result };
}

function fail(code, message) {
  return { ok: false, error: { code, message: String(message ?? code) } };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

class MinutesService {
  constructor(config) {
    this.config = { ...DEFAULTS, ...(config || {}) };
    this.settingsReady = null;
    this.voiceLibraryQueue = Promise.resolve();
  }

  async withVoiceLibraryLock(operation) {
    const previous = this.voiceLibraryQueue;
    let release;
    this.voiceLibraryQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  settingsPath() {
    return join(this.config.dataDir || DEFAULTS.dataDir, 'settings.json');
  }

  meetingsDir() {
    return join(this.config.dataDir || DEFAULTS.dataDir, 'meetings');
  }

  async readSettings() {
    await this.readSettingsFile();
    await this.loadApiKey();
    await this.loadSiliconflowApiKey();
    await this.loadTranslationApiKey();
    return this.getSettings();
  }

  /**
   * Re-read the settings file without touching the keychain. The panel polls
   * this path, and the keychain entries only change when the user saves.
   */
  async readSettingsFile() {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      const saved = JSON.parse(raw);
      this.config = { ...this.config, ...saved };
    } catch {
      /* 没有配置文件就用默认值 */
    }
    delete this.config.apiKey;
    delete this.config.siliconflowApiKey;
    delete this.config.translationApiKey;
    return this.getSettings();
  }

  async ensureSettings() {
    if (!this.settingsReady) {
      this.settingsReady = this.readSettings().catch((error) => {
        this.settingsReady = null;
        throw error;
      });
    }
    return this.settingsReady;
  }

  getSettings() {
    const { apiKey, siliconflowApiKey, translationApiKey, ...rest } = this.config;
    return {
      ...rest,
      apiKeySet: Boolean(apiKey),
      siliconflowApiKeySet: Boolean(siliconflowApiKey),
      translationApiKeySet: Boolean(translationApiKey),
    };
  }

  async writeSettings(patch) {
    const current = await this.readSettings();
    const next = { ...current, ...(patch || {}) };
    delete next.apiKeySet;
    delete next.apiKey;
    delete next.siliconflowApiKeySet;
    delete next.siliconflowApiKey;
    delete next.speakers;
    delete next.translationApiKeySet;
    delete next.translationApiKey;
    let keyInKeychain = false;
    let siliconflowKeyInKeychain = false;
    let translationKeyInKeychain = false;
    if (typeof patch?.apiKey === 'string' && patch.apiKey.length > 0) {
      keyInKeychain = await keychainWrite(patch.apiKey);
      if (!keyInKeychain) next.apiKey = patch.apiKey;
    }
    if (typeof patch?.siliconflowApiKey === 'string' && patch.siliconflowApiKey.length > 0) {
      siliconflowKeyInKeychain = await keychainWrite(patch.siliconflowApiKey, SILICONFLOW_KEYCHAIN_SERVICE);
      if (!siliconflowKeyInKeychain) next.siliconflowApiKey = patch.siliconflowApiKey;
    }
    if (typeof patch?.translationApiKey === 'string' && patch.translationApiKey.length > 0) {
      translationKeyInKeychain = await keychainWrite(patch.translationApiKey, TRANSLATION_KEYCHAIN_SERVICE);
      if (!translationKeyInKeychain) next.translationApiKey = patch.translationApiKey;
    }
    this.config = { ...this.config, ...next };
    if (keyInKeychain) this.config.apiKey = await keychainRead();
    if (siliconflowKeyInKeychain) this.config.siliconflowApiKey = await keychainRead(SILICONFLOW_KEYCHAIN_SERVICE);
    if (translationKeyInKeychain) this.config.translationApiKey = await keychainRead(TRANSLATION_KEYCHAIN_SERVICE);
    await mkdir(this.config.dataDir, { recursive: true });
    await writeFile(this.settingsPath(), JSON.stringify(next, null, 2), 'utf8');
    return this.getSettings();
  }

  /** Read the secret back: keychain first, settings file only as a fallback. */
  async loadApiKey() {
    const stored = await keychainRead();
    if (stored) {
      this.config.apiKey = stored;
      return stored;
    }
    return this.config.apiKey || '';
  }

  async loadSiliconflowApiKey() {
    const stored = await keychainRead(SILICONFLOW_KEYCHAIN_SERVICE);
    if (stored) {
      this.config.siliconflowApiKey = stored;
      return stored;
    }
    return this.config.siliconflowApiKey || '';
  }

  async loadTranslationApiKey() {
    const stored = await keychainRead(TRANSLATION_KEYCHAIN_SERVICE);
    if (stored) {
      this.config.translationApiKey = stored;
      return stored;
    }
    return this.config.translationApiKey || '';
  }

  /* ------------------------------ health ------------------------------ */

  async probe(url, kind) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const headers = {};
      const apiKey = kind === 'asr' && this.config.asrProvider === 'siliconflow'
        ? await this.loadSiliconflowApiKey()
        : kind === 'llm' && this.config.llmProvider !== 'lmstudio' ? this.config.apiKey || (await this.loadApiKey()) : '';
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      const target = kind === 'asr'
        ? this.config.asrProvider === 'siliconflow'
          ? joinUrl(this.config.siliconflowBaseUrl, '/models')
          : joinUrl(this.config.asrBaseUrl, '/health')
        : joinUrl(this.config.llmBaseUrl, '/models');
      const res = await fetch(target, { headers, signal: controller.signal });
      if (!res.ok) return { alive: false, detail: 'HTTP ' + res.status };
      const text = await res.text();
      let models = [];
      try {
        const data = JSON.parse(text);
        models = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
      } catch {
        /* 非 JSON 响应也算连通 */
      }
      return { alive: true, models, detail: kind === 'asr' ? text.slice(0, 120) : '' };
    } catch (error) {
      return { alive: false, detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    // Re-read the file every time, so the panel never shows a cached model or
    // provider that the settings file no longer holds.
    await this.readSettingsFile();
    const [asr, llm] = await Promise.all([
      this.probe(this.config.asrBaseUrl, 'asr'),
      this.probe(this.config.llmBaseUrl, 'llm'),
    ]);
    return { asr, llm, settings: this.getSettings() };
  }

  /* ---------------------------- transcribe ---------------------------- */

  audioDir() {
    return join(this.config.dataDir || DEFAULTS.dataDir, 'audio');
  }

  async saveAudio(bytes, filename) {
    const ext = String(filename || '').split('.').pop() || 'webm';
    const id = 'audio-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await mkdir(this.audioDir(), { recursive: true });
    const path = join(this.audioDir(), id + '.' + ext.replace(/[^a-z0-9]/gi, '').toLowerCase());
    await writeFile(path, bytes);
    return { id, path, filename: filename || id, size: bytes.length };
  }

  async readAudio(audioId) {
    if (!audioId) return null;
    const dir = this.audioDir();
    try {
      const names = await readdir(dir);
      const hit = names.find((n) => n.startsWith(audioId + '.'));
      if (!hit) return null;
      const path = join(dir, hit);
      return { path, bytes: await readFile(path) };
    } catch {
      return null;
    }
  }

  /**
   * Every audio file that belongs to one meeting: the uploaded original and
   * the tracks a live session recorded. A live track is raw PCM, so it is
   * served through the WAV wrapper the player already uses.
   */
  async listMeetingAudio(id) {
    const meetingId = String(id || '');
    const files = [];
    if (!meetingId) return files;
    const record = await this.readMeetingRecord(meetingId);
    const audioId = String(record?.audioId || '');
    if (audioId) {
      const names = await readdir(this.audioDir()).catch(() => []);
      const filename = names.find((name) => name.startsWith(audioId + '.'));
      if (filename) {
        const info = await stat(join(this.audioDir(), filename)).catch(() => null);
        if (info?.isFile()) {
          files.push({
            id: audioId,
            kind: 'upload',
            name: filename,
            size: info.size,
            mime: audioContentType(filename),
            url: `/api/ai-minutes/meeting-audio?id=${encodeURIComponent(audioId)}`,
            downloadUrl: `/api/ai-minutes/meeting-audio?id=${encodeURIComponent(audioId)}&download=1`,
          });
        }
      }
    }
    if (/^realtime-[A-Za-z0-9-]+$/.test(meetingId)) {
      const directory = join(this.config.dataDir, 'realtime', meetingId);
      const tracks = [];
      for (const track of ['mic', 'system']) {
        const info = await stat(join(directory, track + '.pcm')).catch(() => null);
        if (info?.isFile()) tracks.push({ track, info });
      }
      if (tracks.length) {
        const completeUrl = `/api/ai-minutes/live-audio?id=${encodeURIComponent(meetingId)}&track=mix`;
        // The complete recording is the default playback and the only download.
        files.push({
          id: meetingId + ':mix',
          kind: 'mix',
          track: 'mix',
          name: 'meeting.wav',
          size: Math.max(...tracks.map((item) => item.info.size)) + 44,
          mime: 'audio/wav',
          url: completeUrl,
          downloadUrl: completeUrl + '&download=1',
        });
        for (const { track, info } of tracks) {
          files.push({
            id: meetingId + ':' + track,
            kind: 'track',
            track,
            name: track + '.pcm',
            size: info.size,
            mime: 'audio/wav',
            url: `/api/ai-minutes/live-audio?id=${encodeURIComponent(meetingId)}&track=${track}`,
            downloadUrl: completeUrl + '&download=1',
          });
        }
      }
    }
    return files;
  }

  /**
   * Remove one audio file. The transcript, the translation and the minutes
   * stay; only the recording is gone.
   */
  async deleteMeetingAudio(payload = {}) {
    const meetingId = String(payload.id || '');
    const kind = String(payload.kind || '');
    if (!meetingId) return fail('minutes/audio-missing', '缺少会议 ID');
    if (kind === 'upload') {
      const record = await this.readMeetingRecord(meetingId);
      const audioId = String(record?.audioId || '');
      if (!audioId) return fail('minutes/audio-missing', '这场会议没有上传的音频');
      const names = await readdir(this.audioDir()).catch(() => []);
      const filename = names.find((name) => name.startsWith(audioId + '.'));
      if (!filename) return fail('minutes/audio-missing', '音频文件不存在');
      await rm(join(this.audioDir(), filename), { force: true });
      await this.updateMeeting(meetingId, { audioId: '' });
      return ok({ files: await this.listMeetingAudio(meetingId) });
    }
    if (kind === 'track') {
      const track = String(payload.track || '');
      if (!['mic', 'system', 'mix'].includes(track)) return fail('minutes/audio-track', '无效的音轨');
      if (!/^realtime-[A-Za-z0-9-]+$/.test(meetingId)) return fail('minutes/audio-missing', '这场会议没有音轨');
      const path = join(this.config.dataDir, 'realtime', meetingId, track + '.pcm');
      if (!await pathExists(path)) return fail('minutes/audio-missing', '音轨不存在');
      await rm(path, { force: true });
      return ok({ files: await this.listMeetingAudio(meetingId) });
    }
    if (kind === 'mix') {
      // The complete recording is served from the mic and system tracks, so
      // removing it removes both of them.
      if (!/^realtime-[A-Za-z0-9-]+$/.test(meetingId)) return fail('minutes/audio-missing', '这场会议没有音轨');
      const directory = join(this.config.dataDir, 'realtime', meetingId);
      let removed = false;
      for (const track of ['mic', 'system']) {
        const path = join(directory, track + '.pcm');
        if (await pathExists(path)) {
          await rm(path, { force: true });
          removed = true;
        }
      }
      if (!removed) return fail('minutes/audio-missing', '音轨不存在');
      return ok({ files: await this.listMeetingAudio(meetingId) });
    }
    return fail('minutes/audio-kind', '未知的音频类型');
  }

  async transcribe(audio, options) {
    await this.ensureSettings();
    const opts = options || {};
    let bytes;
    let filename = opts.filename || 'meeting.webm';
    if (audio?.audioId) {
      const stored = await this.readAudio(audio.audioId);
      if (!stored) return fail('minutes/audio-missing', '音频不存在或已清理');
      bytes = stored.bytes;
      filename = stored.path.split('/').pop() || filename;
    } else if (audio?.base64) {
      bytes = Buffer.from(audio.base64, 'base64');
    } else {
      return fail('minutes/no-audio', '缺少音频内容');
    }
    try {
      const converted = await convertAudioToWav(bytes, opts.filename || filename);
      bytes = converted.bytes;
      filename = converted.filename;
    } catch (error) {
      return fail('minutes/audio-convert-failed', '音频转换失败，请确认已安装 ffmpeg：' + (error instanceof Error ? error.message : String(error)));
    }
    const cloud = this.config.asrProvider === 'siliconflow';
    const fields = cloud
      ? { model: opts.model || this.config.siliconflowModel, response_format: 'verbose_json' }
      : {
        model: opts.model || this.config.asrModel || 'base',
        response_format: 'verbose_json',
      };
    if (!cloud && (opts.language || this.config.language)) fields.language = opts.language || this.config.language;
    if (!cloud) {
      if (opts.hotwords) fields.hotwords = String(opts.hotwords);
      if (opts.itn !== undefined) fields.itn = String(opts.itn !== false);
    }
    try {
      const headers = cloud ? { Authorization: 'Bearer ' + await this.loadSiliconflowApiKey() } : {};
      if (cloud && headers.Authorization === 'Bearer ') {
        return fail('minutes/siliconflow-key-missing', '请在设置中填写 SiliconFlow API Key');
      }
      const baseUrl = cloud ? this.config.siliconflowBaseUrl : this.config.asrBaseUrl;
      const path = cloud ? '/audio/transcriptions' : this.config.asrPath;
      const response = await postAudio(joinUrl(baseUrl, path), { bytes, filename, fields, headers });
      const text = response.text;
      if (response.status < 200 || response.status >= 300) {
        return fail('minutes/asr-failed', '转写失败（HTTP ' + response.status + '）：' + text.slice(0, 160));
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { text };
      }
      const segments = Array.isArray(data.segments) ? data.segments : [];
      const transcript = typeof data.text === 'string' && data.text.length > 0
        ? data.text
        : segments.map((s) => s.text || '').join('');
      const voiceprints = data.voiceprints && typeof data.voiceprints === 'object' ? data.voiceprints : {};
      let speakerLabels = {};
      let speakerProfiles = {};
      if (Object.keys(voiceprints).length) {
        const resolved = await this.resolveVoiceLabels(voiceprints);
        speakerLabels = resolved.labels;
        speakerProfiles = resolved.profiles;
      }
      return ok({
        voiceprints,
        speakerLabels,
        speakerProfiles,
        transcript,
        segments: segments.map((s) => ({
          start: s.start ?? 0,
          end: s.end ?? 0,
          text: s.text || '',
          speaker: s.speaker || '',
        })),
        language: data.language || '',
        duration: data.duration ?? 0,
        audioId: audio?.audioId || '',
      });
    } catch (error) {
      return fail('minutes/asr-unreachable', (cloud ? 'SiliconFlow' : '本地') + '转写服务不可达：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /* ----------------------------- chat -------------------------------- */

  /** Read the model ids exposed by an OpenAI compatible endpoint. */
  async listModels(options = {}) {
    const baseUrl = options.baseUrl || this.config.translationBaseUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(joinUrl(baseUrl, '/models'), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const text = await res.text();
      if (!res.ok) return fail('minutes/models-failed', '读取模型列表失败（HTTP ' + res.status + '）：' + text.slice(0, 160));
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail('minutes/models-bad-json', '模型列表接口返回的不是 JSON');
      }
      const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const models = items
        .map((item) => (typeof item === 'string' ? item : item?.id || item?.name || ''))
        .filter((value) => typeof value === 'string' && value.length > 0);
      return ok({ models, baseUrl });
    } catch (error) {
      return fail('minutes/models-unreachable', '无法读取模型列表：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(messages, options) {
    await this.ensureSettings();
    const opts = options || {};
    const translation = opts.provider === 'translation';
    const profile = opts.profile || null;
    const provider = profile?.provider || (translation ? this.config.translationProvider : this.config.llmProvider);
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = provider === 'lmstudio'
      ? ''
      : translation
        ? (await this.loadTranslationApiKey()) || (provider === 'minimax' ? await this.loadApiKey() : '')
        : this.config.apiKey || (await this.loadApiKey());
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const body = {
      model: opts.model || profile?.model || (translation ? this.config.translationModel : this.config.llmModel) || 'local-model',
      messages,
      temperature: opts.temperature ?? (translation ? this.config.translationTemperature : this.config.llmTemperature) ?? 0.2,
      stream: false,
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    const reasoningEffort = opts.reasoningEffort || (translation ? this.config.translationReasoningEffort : this.config.llmReasoningEffort);
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    const maxTokens = opts.maxTokens || (translation ? this.config.translationMaxTokens : this.config.llmMaxTokens);
    if (maxTokens) body.max_tokens = maxTokens;
    const baseUrl = opts.baseUrl || profile?.baseUrl || (translation ? this.config.translationBaseUrl : this.config.llmBaseUrl);
    const path = profile?.path || (translation ? this.config.translationPath : this.config.llmPath);
    try {
      const send = async (payload) => {
        const res = await fetch(joinUrl(baseUrl, path), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        return { res, text: await res.text() };
      };
      let res;
      let text;
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          ({ res, text } = await send(body));
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!res) {
        const host = (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })();
        return fail('minutes/llm-unreachable', '对话端点不可达（' + host + '）：' + (lastError instanceof Error ? lastError.message : String(lastError)));
      }
      // LM Studio and some other OpenAI-compatible local servers accept only
      // json_schema or text. The prompts already ask for JSON, so plain text is
      // a safe fallback and the existing parser still validates the result.
      if (!res.ok && body.response_format && /response_format|json_object|json_schema/i.test(text)) {
        const retry = { ...body };
        delete retry.response_format;
        const second = await send(retry);
        res = second.res;
        text = second.text;
      }
      if (!res.ok && body.reasoning_effort && /reasoning_effort|unknown field|unsupported|unrecognized/i.test(text)) {
        const retry = { ...body };
        delete retry.reasoning_effort;
        const second = await send(retry);
        res = second.res;
        text = second.text;
      }
      if (!res.ok) return fail('minutes/llm-failed', '对话端点失败（HTTP ' + res.status + '）：' + text.slice(0, 200));
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail('minutes/llm-bad-json', '对话端点返回的不是 JSON');
      }
      const content = data?.choices?.[0]?.message?.content
        ?? (Array.isArray(data?.content) ? data.content.map((c) => c?.text || '').join('') : '')
        ?? data?.output_text
        ?? '';
      if (!content) return fail('minutes/llm-empty', '对话端点没有返回内容');
      return ok({ text: String(content) });
    } catch (error) {
      return fail('minutes/llm-unreachable', '对话端点不可达：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * Run a minutes or Q&A call against the primary endpoint and, when that
   * endpoint fails or answers nothing usable, against the configured fallback.
   * The answer reports which endpoint produced it.
   */
  async chatWithFallback(messages, options) {
    const opts = options || {};
    const accept = typeof opts.accept === 'function' ? opts.accept : (text) => Boolean(text);
    await this.ensureSettings();
    const { primary, fallback } = this.llmProfiles();
    // Each profile carries its own reasoning effort: a cloud model that needs
    // thinking must not switch the local fallback into thinking mode too.
    const run = async (profile) => this.chat(messages, { ...opts, profile, reasoningEffort: profile.reasoningEffort });
    const first = await run(primary);
    const firstText = first.ok ? String(first.result?.text || '') : '';
    if (first.ok && accept(firstText)) {
      return ok({ text: firstText, provider: primary.provider, fallbackUsed: false });
    }
    if (!this.llmFallbackReady()) {
      return first.ok ? fail('minutes/llm-empty', '纪要模型没有返回内容') : first;
    }
    const second = await run(fallback);
    const secondText = second.ok ? String(second.result?.text || '') : '';
    if (second.ok && accept(secondText)) {
      return ok({
        text: secondText,
        provider: fallback.provider,
        fallbackUsed: true,
        primaryError: first.ok ? '纪要模型没有返回内容' : first.error?.message || '',
      });
    }
    return second.ok ? fail('minutes/llm-empty', '兜底纪要模型没有返回内容') : second;
  }

  /** Parse a glossary written as one "source = target" pair per line. */
  parseGlossary(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return { source: line.slice(0, index).trim().replace(/^`|`$/g, ''), target: line.slice(index + 1).trim().replace(/^`|`$/g, '') };
      })
      .filter((pair) => pair.source && pair.target);
  }

  /** Remove markdown fences, stray quotes and labels that translation models sometimes add. */
  cleanTranslation(text) {
    let value = String(text || '').trim();
    value = value.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    value = value.replace(/^[`'\"“”]+/, '').replace(/[`'\"“”]+$/, '').trim();
    value = value.replace(/^(译文|翻译结果|翻译|translation|translated text|answer)\s*[:：]\s*/i, '').trim();
    return value;
  }

  /** Build the strict translation instruction used by live translation and model comparison. */
  translationInstruction(input, options = {}) {
    const model = options.model || this.config.translationModel || '';
    const mode = options.promptMode || this.config.translationPromptMode || 'auto';
    const hyMt = mode === 'hymt' || (mode === 'auto' && /hy[-_]?mt/i.test(model));
    if (!hyMt) {
      const target = TARGET_LANGUAGES[options.targetLanguage] || TARGET_LANGUAGES.en;
      const source = options.sourceLanguage === 'zh'
        ? 'Chinese (zh-Hans)'
        : options.sourceLanguage === 'en' ? 'English (en)' : '';
      return source
        ? `You are a professional ${source} to ${target} translator. Produce only the ${target} translation, without explanations. Translate the following text:\n\n${input}`
        : `You are a professional translator. Produce only the ${target} translation, without explanations. Translate the following text into ${target}:\n\n${input}`;
    }
    const chinese = options.promptLanguage !== 'en';
    const names = chinese ? HYMT_LANGUAGE_NAMES_ZH : HYMT_LANGUAGE_NAMES_EN;
    const target = names[options.targetLanguage] || names.en;
    const glossary = this.parseGlossary(options.glossary ?? this.config.translationGlossary);
    if (chinese) {
      const terms = glossary.length
        ? ['*参考下面的翻译：*', ...glossary.map((pair) => `\`${pair.source}\` 翻译成 \`${pair.target}\``)].join('\n')
        : '';
      const task = `将以下文本翻译为 \`${target}\`，注意**只需要输出翻译后的结果，不要额外解释**：\n\n${input}`;
      return terms ? `${terms}\n${task}` : task;
    }
    const terms = glossary.length
      ? ['*Reference the following translations:*', ...glossary.map((pair) => `\`${pair.source}\` translates to \`${pair.target}\``)].join('\n')
      : '';
    const task = `Translate the following text into \`${target}\`. Note that you must **ONLY output the translated result without any additional explanation**:\n\n${input}`;
    return terms ? `${terms}\n\n${task}` : task;
  }

  /** Run the same sentences through several models and report latency plus output hygiene. */
  async compareTranslation(payload = {}) {
    const sentences = (Array.isArray(payload.sentences) ? payload.sentences : [])
      .map((sentence) => String(sentence || '').trim())
      .filter((sentence) => sentence.length > 0)
      .slice(0, Math.max(1, Math.min(20, Number(payload.limit) || 8)));
    const models = (Array.isArray(payload.models) ? payload.models : [])
      .map((model) => String(model || '').trim())
      .filter((model) => model.length > 0)
      .slice(0, 4);
    if (!sentences.length) return fail('minutes/no-text', '缺少待对比的句子');
    if (!models.length) return fail('minutes/no-model', '缺少待对比的模型');
    const options = payload.options || {};
    const results = [];
    for (const model of models) {
      const samples = [];
      let preambleHits = 0;
      let emptyCount = 0;
      let totalMs = 0;
      for (const sentence of sentences) {
        const startedAt = Date.now();
        const result = await this.chat(
          [{ role: 'user', content: this.translationInstruction(sentence, { ...options, model }) }],
          {
            provider: 'translation',
            model,
            temperature: this.config.translationTemperature ?? 0.1,
            reasoningEffort: this.config.translationReasoningEffort || 'none',
            maxTokens: this.config.translationMaxTokens || 768,
          },
        );
        const elapsed = Date.now() - startedAt;
        totalMs += elapsed;
        const text = result.ok ? this.cleanTranslation(result.result?.text) : '';
        if (!text) emptyCount += 1;
        if (/^(here (is|are)|translation:|translated text|以下是|翻译如下|译文[:：])/i.test(text)) preambleHits += 1;
        samples.push({ source: sentence, translation: text, ms: elapsed, error: result.ok ? '' : result.error?.message || 'failed' });
      }
      results.push({
        model,
        samples,
        avgMs: sentences.length ? Math.round(totalMs / sentences.length) : 0,
        preambleHits,
        emptyCount,
      });
    }
    return ok({ results, sentences: sentences.length });
  }

  /** The primary and the fallback minutes/Q&A endpoints. */
  llmProfiles() {
    return {
      primary: {
        provider: this.config.llmProvider,
        baseUrl: this.config.llmBaseUrl,
        path: this.config.llmPath,
        model: this.config.llmModel,
        reasoningEffort: this.config.llmReasoningEffort || '',
      },
      fallback: {
        provider: this.config.llmFallbackProvider,
        baseUrl: this.config.llmFallbackBaseUrl,
        path: this.config.llmFallbackPath,
        model: this.config.llmFallbackModel,
        reasoningEffort: this.config.llmFallbackReasoningEffort ?? 'none',
      },
    };
  }

  /** The fallback only runs when it is switched on and fully configured. */
  llmFallbackReady() {
    const fallback = this.llmProfiles().fallback;
    return Boolean(this.config.llmFallbackEnabled && fallback.provider && fallback.baseUrl && fallback.model);
  }

  /** The primary and the fallback translation endpoints. */
  translationProfiles() {
    return {
      primary: {
        provider: this.config.translationProvider,
        baseUrl: this.config.translationBaseUrl,
        path: this.config.translationPath,
        model: this.config.translationModel,
        reasoningEffort: this.config.translationReasoningEffort || '',
      },
      fallback: {
        provider: this.config.translationFallbackProvider,
        baseUrl: this.config.translationFallbackBaseUrl,
        path: this.config.translationFallbackPath,
        model: this.config.translationFallbackModel,
        reasoningEffort: this.config.translationFallbackReasoningEffort ?? 'none',
      },
    };
  }

  async translate(text, options) {
    const opts = options || {};
    const input = String(text || '').trim();
    if (!input) return fail('minutes/no-text', '缺少待翻译文本');
    await this.ensureSettings();
    const { primary, fallback } = this.translationProfiles();
    const run = async (profile) => {
      const instruction = this.translationInstruction(input, { ...opts, model: profile.model });
      const result = await this.chat([{ role: 'user', content: instruction }], {
        provider: 'translation',
        profile,
        temperature: this.config.translationTemperature ?? 0.1,
        reasoningEffort: profile.reasoningEffort,
        maxTokens: this.config.translationMaxTokens || 768,
      });
      const translation = result.ok ? this.cleanTranslation(result.result.text) : '';
      return { result, translation };
    };
    const first = await run(primary);
    if (first.result.ok && first.translation) {
      return ok({ translation: first.translation, provider: primary.provider, fallbackUsed: false });
    }
    if (this.config.translationFallbackEnabled && fallback.provider && fallback.baseUrl && fallback.model) {
      const second = await run(fallback);
      if (second.result.ok && second.translation) {
        return ok({
          translation: second.translation,
          provider: fallback.provider,
          fallbackUsed: true,
          primaryError: first.result.ok ? '翻译结果为空' : first.result.error?.message || '',
        });
      }
      return second.result.ok ? fail('minutes/translation-empty', '兜底翻译模型没有返回内容') : second.result;
    }
    return first.result.ok ? fail('minutes/translation-empty', '翻译模型没有返回内容') : first.result;
  }

  /**
   * Translate with a streaming endpoint, so the caption can grow while the
   * model is still writing instead of appearing all at once at the end.
   */
  async translateStream(text, options, onDelta) {
    const opts = options || {};
    const input = String(text || '').trim();
    if (!input) return fail('minutes/no-text', '缺少待翻译文本');
    await this.ensureSettings();
    const { primary, fallback } = this.translationProfiles();
    const run = async (profile) => {
      const instruction = this.translationInstruction(input, { ...opts, model: profile.model });
      const result = await this.chatStream([{ role: 'user', content: instruction }], {
        provider: 'translation',
        profile,
        temperature: this.config.translationTemperature ?? 0.1,
        reasoningEffort: profile.reasoningEffort,
        maxTokens: this.config.translationMaxTokens || 768,
      }, onDelta);
      const translation = result.ok ? this.cleanTranslation(result.result.text) : '';
      return { result, translation };
    };
    let first = await run(primary);
    if (!first.result.ok) {
      // A server that cannot stream still gets the plain answer.
      const plain = await this.translate(input, opts);
      first = plain.ok
        ? { result: { ok: true, result: { text: plain.result?.translation || '' } }, translation: plain.result?.translation || '' }
        : { result: { ok: false, error: plain.error }, translation: '' };
    }
    if (first.result.ok && first.translation) {
      return ok({ translation: first.translation, provider: primary.provider, fallbackUsed: false });
    }
    if (this.config.translationFallbackEnabled && fallback.provider && fallback.baseUrl && fallback.model) {
      const second = await run(fallback);
      if (second.result.ok && second.translation) {
        return ok({
          translation: second.translation,
          provider: fallback.provider,
          fallbackUsed: true,
          primaryError: first.result.ok ? '翻译结果为空' : first.result.error?.message || '',
        });
      }
      return second.result.ok ? fail('minutes/translation-empty', '兜底翻译模型没有返回内容') : second.result;
    }
    return first.result.ok ? fail('minutes/translation-empty', '翻译模型没有返回内容') : first.result;
  }

  /**
   * Read an OpenAI style event stream and hand every text delta to the
   * caller as it arrives.
   */
  async chatStream(messages, options, onDelta) {
    await this.ensureSettings();
    const opts = options || {};
    const translation = opts.provider === 'translation';
    const profile = opts.profile || null;
    const provider = profile?.provider || (translation ? this.config.translationProvider : this.config.llmProvider);
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const apiKey = provider === 'lmstudio'
      ? ''
      : translation
        ? (await this.loadTranslationApiKey()) || (provider === 'minimax' ? await this.loadApiKey() : '')
        : this.config.apiKey || (await this.loadApiKey());
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const body = {
      model: opts.model || profile?.model || (translation ? this.config.translationModel : this.config.llmModel) || 'local-model',
      messages,
      temperature: opts.temperature ?? (translation ? this.config.translationTemperature : this.config.llmTemperature) ?? 0.2,
      stream: true,
    };
    const reasoningEffort = opts.reasoningEffort || (translation ? this.config.translationReasoningEffort : this.config.llmReasoningEffort);
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    const maxTokens = opts.maxTokens || (translation ? this.config.translationMaxTokens : this.config.llmMaxTokens);
    if (maxTokens) body.max_tokens = maxTokens;
    const baseUrl = opts.baseUrl || profile?.baseUrl || (translation ? this.config.translationBaseUrl : this.config.llmBaseUrl);
    const path = profile?.path || (translation ? this.config.translationPath : this.config.llmPath);
    let res;
    try {
      res = await fetch(joinUrl(baseUrl, path), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      const host = (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })();
      return fail('minutes/llm-unreachable', '对话端点不可达（' + host + '）：' + (error instanceof Error ? error.message : String(error)));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return fail('minutes/llm-stream-failed', '流式请求失败（HTTP ' + res.status + '）：' + text.slice(0, 160));
    }
    if (!res.body) return fail('minutes/llm-stream-failed', '流式响应没有内容');
    let full = '';
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          const choice = (event.choices || [])[0] || {};
          const delta = choice.delta || {};
          const content = typeof delta.content === 'string'
            ? delta.content
            : Array.isArray(delta.content) ? delta.content.map((part) => part?.text || '').join('') : '';
          if (!content) continue;
          full += content;
          if (typeof onDelta === 'function') onDelta(full, content);
        }
      }
    } catch (error) {
      if (!full) return fail('minutes/llm-stream-failed', '流式读取失败：' + (error instanceof Error ? error.message : String(error)));
    }
    if (!full) return fail('minutes/translation-empty', '翻译模型没有返回内容');
    return ok({ text: full, streaming: true });
  }

  async summarize(transcript, context) {
    const ctx = context || {};
    const templateId = String(ctx.template || 'intelligent-slicing');
    const templateHint = TEMPLATE_PROMPTS[templateId] || TEMPLATE_PROMPTS['intelligent-slicing'];
    const language = String(ctx.language || '').trim();
    const prompt = [
      `【输出要求】${templateHint}`,
      '你是产品评审会的纪要助手。下面是一场会议的转写文本与上下文，请只输出 JSON。',
      language ? `【输出语言】${language}（所有文字都必须用${language}书写）` : '',
      '',
      '【会议】' + (ctx.title || '未命名会议'),
      ctx.date ? '【时间】' + ctx.date : '',
      '',
      '【转写文本】',
      transcript || '（转写为空）',
      '',
      '【输出结构】',
      JSON.stringify(TEMPLATE_SCHEMAS[templateId] || TEMPLATE_SCHEMAS['intelligent-slicing'], null, 2),
    ].filter(Boolean).join('\n');
    const system = language
      ? `你只输出 JSON 格式的会议纪要，不要输出其它文字。所有文字必须用${language}书写。`
      : '你只输出 JSON 格式的会议纪要，不要输出其它文字。';
    const result = await this.chatWithFallback([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], { json: true, accept: (text) => Boolean(parseMinutesJson(text)) });
    if (!result.ok) {
      if (result.error?.code === 'minutes/llm-empty') {
        return fail('minutes/summary-not-json', '模型没有返回可解析的 JSON');
      }
      return result;
    }
    const text = String(result.result.text || '').trim();
    const parsed = parseMinutesJson(text);
    if (!parsed) return fail('minutes/summary-not-json', '模型没有返回可解析的 JSON');
    return ok({
      minutes: parsed,
      raw: text,
      template: templateId,
      provider: result.result.provider,
      fallbackUsed: result.result.fallbackUsed,
      primaryError: result.result.primaryError,
    });
  }

  async ask(transcript, question, context) {
    const ctx = context || {};
    const result = await this.chatWithFallback([
      { role: 'system', content: '你是评审会助手。只依据给出的转写内容回答，引用事实，不要编造。' },
      {
        role: 'user',
        content: [
          ctx.title ? '【会议】' + ctx.title : '',
          '【转写文本】',
          transcript || '',
          '',
          '【问题】' + (question || ''),
        ].filter(Boolean).join('\n'),
      },
    ]);
    if (!result.ok) return result;
    const answer = String(result.result.text || '');
    if (ctx.meetingId) {
      const path = join(this.meetingsDir(), ctx.meetingId + '.json');
      const raw = await readFile(path, 'utf8').catch(() => null);
      if (raw) {
        try {
          const record = JSON.parse(raw);
          const qa = Array.isArray(record.qa) ? record.qa : [];
          qa.push({ question: question || '', answer, createdAt: nowIso() });
          await this.updateMeeting(ctx.meetingId, { qa });
        } catch {
          /* Keep the answer in memory when the record cannot be updated. */
        }
      }
    }
    return ok({
      answer,
      provider: result.result.provider,
      fallbackUsed: result.result.fallbackUsed,
      primaryError: result.result.primaryError,
    });
  }

  /* --------------------------- text normalisation ---------------------- */

  /** Convert traditional Chinese characters to simplified ones. */
  toSimplified(text) {
    const value = String(text || '');
    const { map, maxLen } = T2S;
    if (!value || !map || !Object.keys(map).length) return value;
    if (!/[\u3400-\u9fff]/.test(value)) return value;
    let output = '';
    let index = 0;
    while (index < value.length) {
      let matched = false;
      for (let length = Math.min(maxLen, value.length - index); length >= 1; length -= 1) {
        const candidate = value.slice(index, index + length);
        const replacement = map[candidate];
        if (replacement !== undefined) {
          output += replacement;
          index += length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        output += value[index];
        index += 1;
      }
    }
    return output;
  }

  /** Attach simplified text variants when a transcript uses traditional characters. */
  withSimplified(record) {
    if (!record) return record;
    const transcript = String(record.transcript || '');
    const simplified = this.toSimplified(transcript);
    if (simplified !== transcript) record.transcriptSimplified = simplified;
    if (Array.isArray(record.segments)) {
      record.segments = record.segments.map((segment) => {
        const text = String(segment?.text || '');
        const simple = this.toSimplified(text);
        return simple !== text ? { ...segment, textSimplified: simple } : segment;
      });
    }
    return record;
  }

  /* ------------------------- pass 2 finalisation ----------------------- */

  /** Run the accumulated session audio through the ASR service for a final transcript. */
  async finalizeSession(session, options = {}) {
    const id = String(session?.id || '');
    if (!id) return fail('minutes/live-no-session', '没有可精修的会议');
    const directory = join(this.config.dataDir, 'realtime', id);
    const hotwords = String(options.hotwords ?? session.hotwords ?? this.config.hotwords ?? '');
    const language = options.language || this.config.asrLanguage || 'auto';
    const base = String(this.config.asrBaseUrl || '').replace(/\/v1\/?$/, '');
    const url = joinUrl(base, '/finalize');
    const segments = [];
    const voiceprints = {};
    let text = '';
    const startedAt = Date.now();
    for (const track of ['mic', 'system']) {
      let pcm;
      try {
        pcm = await readFile(join(directory, track + '.pcm'));
      } catch {
        continue;
      }
      if (!pcm || pcm.length < 32) continue;
      let response;
      try {
        response = await postAudio(url, {
          bytes: pcmToWav(pcm),
          filename: `finalize-${track}.wav`,
          fields: { track, hotwords, language, itn: 'true' },
        });
      } catch (error) {
        return fail('minutes/live-finalize-failed', '精修请求失败：' + (error instanceof Error ? error.message : String(error)));
      }
      if (response.status < 200 || response.status >= 300) {
        return fail('minutes/live-finalize-failed', '精修失败（HTTP ' + response.status + '）：' + response.text.slice(0, 160));
      }
      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return fail('minutes/live-finalize-failed', '精修接口返回的不是 JSON');
      }
      const trackSegments = Array.isArray(payload?.segments) ? payload.segments : [];
      // Each track clusters its own voices, so the system track is namespaced:
      // its "Speaker 1" is not the microphone's "Speaker 1".
      const label = (speaker) => {
        const name = String(speaker || '');
        if (!name) return track;
        return track === 'system' ? 'system · ' + name : name;
      };
      for (const segment of trackSegments) {
        const segmentText = String(segment.text || '').trim();
        if (!segmentText || /^(nan|none|null)([\s,;，、]*nan)*$/i.test(segmentText)) continue;
        const start = Number(segment.start);
        const end = Number(segment.end);
        segments.push({
          start: Number.isFinite(start) ? start : 0,
          end: Number.isFinite(end) ? end : 0,
          text: segmentText,
          speaker: label(segment.speaker),
          source: track,
          audioStart: Number.isFinite(start) ? start : 0,
          audioEnd: Number.isFinite(end) ? end : 0,
        });
      }
      const trackPrints = payload?.voiceprints && typeof payload.voiceprints === 'object' ? payload.voiceprints : {};
      for (const [speaker, vector] of Object.entries(trackPrints)) {
        voiceprints[label(speaker)] = vector;
      }
      if (!trackSegments.length && payload?.text) {
        const whole = String(payload.text).trim();
        if (whole) {
          segments.push({ start: 0, end: Math.round(pcm.length / 2) / 16000, text: whole, speaker: track });
        }
      }
      if (!text && payload?.text) text = String(payload.text).trim();
    }
    segments.sort((left, right) => left.start - right.start);
    if (!text) text = segments.map((segment) => segment.text).join('\n');
    return ok({ text, segments, voiceprints, elapsed: (Date.now() - startedAt) / 1000 });
  }

  /* -------------------------- speaker labelling ------------------------ */

  /** Ask the ASR service who is speaking in one recorded track. */
  async diarizeTrack(pcm, track) {
    const base = String(this.config.asrBaseUrl || '').replace(/\/v1\/?$/, '');
    const url = joinUrl(base, '/diarize');
    let response;
    try {
      response = await postAudio(url, {
        bytes: pcmToWav(pcm),
        filename: `diarize-${track}.wav`,
        fields: { track },
      });
    } catch (error) {
      return fail('minutes/diarize-failed', '说话人分离请求失败：' + (error instanceof Error ? error.message : String(error)));
    }
    if (response.status < 200 || response.status >= 300) {
      return fail('minutes/diarize-failed', '说话人分离失败（HTTP ' + response.status + '）');
    }
    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch {
      return fail('minutes/diarize-failed', '说话人分离接口返回的不是 JSON');
    }
    return ok({
      track,
      spans: Array.isArray(payload?.spans) ? payload.spans : [],
      voiceprints: payload?.voiceprints && typeof payload.voiceprints === 'object' ? payload.voiceprints : {},
    });
  }

  /**
   * Give one clustered voice a name that stays the same across tracks, so the
   * same person keeps one label when the microphone and the system track both
   * carry the conversation.
   */
  _globalVoice(voices, vector, fallback) {
    const centroid = Array.isArray(vector) ? vector.map(Number).filter(Number.isFinite) : [];
    const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
    if (centroid.length && norm > 1e-9) {
      const unit = centroid.map((value) => value / norm);
      let best = null;
      for (const voice of voices) {
        if (!voice.unit.length) continue;
        const dot = unit.reduce((sum, value, index) => sum + value * (voice.unit[index] || 0), 0);
        if (!best || dot > best.dot) best = { dot, voice };
      }
      if (best && best.dot >= 0.6) return best.voice.name;
    }
    const name = '发言人 ' + (voices.length + 1);
    voices.push({ name, unit: norm > 1e-9 ? centroid.map((value) => value / norm) : [] });
    return name;
  }

  /** Total seconds of audio recorded for one realtime session. */
  async realtimeTrackSeconds(id) {
    const directory = join(this.config.dataDir, 'realtime', String(id || ''));
    let total = 0;
    for (const track of ['mic', 'system']) {
      const pcm = await readFile(join(directory, track + '.pcm')).catch(() => null);
      if (pcm) total += pcm.length / 2 / 16000;
    }
    return total;
  }

  /**
   * Replace the capture track label on a live meeting with the people who were
   * actually talking. "mic" is a source, not a person, so it must not become
   * the speaker name.
   */
  async labelLiveSpeakers(meeting, options = {}) {
    const id = String(meeting?.id || '');
    const segments = Array.isArray(meeting?.segments) ? meeting.segments : [];
    if (!id || !segments.length) return meeting;
    // A long recording takes minutes to cluster, so the caller may cap it.
    const limit = options.maxSeconds === null ? Infinity : Number(options.maxSeconds ?? 300);
    const directory = join(this.config.dataDir, 'realtime', id);
    const voices = [];
    const spans = [];
    const voiceprints = {};
    for (const track of ['mic', 'system']) {
      const pcm = await readFile(join(directory, track + '.pcm')).catch(() => null);
      if (!pcm || pcm.length < 64) continue;
      if (pcm.length / 2 / 16000 > limit) continue;
      const result = await this.diarizeTrack(pcm, track);
      if (!result.ok) continue;
      const prints = result.result.voiceprints || {};
      const names = new Map();
      for (const span of result.result.spans || []) {
        const local = String(span.speaker || '');
        if (!local) continue;
        if (!names.has(local)) {
          const globalName = this._globalVoice(voices, prints[local], local);
          names.set(local, globalName);
          if (Array.isArray(prints[local]) && prints[local].length) {
            voiceprints[globalName] = voiceprints[globalName]
              ? averageVector([voiceprints[globalName], prints[local]]) : prints[local];
          }
        }
        spans.push({
          start: Number(span.start) || 0,
          end: Number(span.end) || 0,
          speaker: names.get(local),
          track,
        });
      }
    }
    if (!spans.length) return meeting;
    const labelled = segments.map((segment) => {
      const start = Number(segment.audioStart);
      const end = Number(segment.audioEnd);
      if (!Number.isFinite(start)) return segment;
      let best = null;
      for (const span of spans) {
        if (segment.source && span.track !== segment.source) continue;
        const overlap = Math.min(end, span.end) - Math.max(start, span.start);
        if (overlap <= 0) continue;
        if (!best || overlap > best.overlap) best = { overlap, span };
      }
      return best ? { ...segment, speaker: best.span.speaker } : segment;
    });
    // 没有对上语音的分段沿用最近一次说话人，而不是把采集音轨名留给人看
    let last = '';
    for (const segment of labelled) {
      if (segment.speaker && segment.speaker !== 'mic' && segment.speaker !== 'system' && segment.speaker !== 'mix') {
        last = segment.speaker;
      } else if (last) {
        segment.speaker = last;
      }
    }
    for (let index = labelled.length - 1; index >= 0; index -= 1) {
      const segment = labelled[index];
      if (segment.speaker && segment.speaker !== 'mic' && segment.speaker !== 'system' && segment.speaker !== 'mix') continue;
      const next = labelled[index + 1];
      if (next?.speaker) segment.speaker = next.speaker;
    }
    return { ...meeting, segments: labelled, voiceprints };
  }

  /* --------------------------- voice profiles -------------------------- */

  /* -------------------------- session recovery ------------------------- */

  /** Rebuild meeting records for realtime sessions that ended without one (for example after a reload). */
  async recoverMeetings() {
    const dataDir = this.config.dataDir;
    const root = join(dataDir, 'realtime');
    const meetingsDir = join(dataDir, 'meetings');
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    let recovered = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^realtime-[A-Za-z0-9-]+$/.test(entry.name)) continue;
      const sessionDir = join(root, entry.name);
      const checkpointRaw = await readFile(join(sessionDir, 'checkpoint.json'), 'utf8').catch(() => '');
      if (!checkpointRaw) continue;
      let checkpoint;
      try {
        checkpoint = JSON.parse(checkpointRaw);
      } catch {
        continue;
      }
      if (!['stopped', 'error', 'ended'].includes(String(checkpoint.status || ''))) continue;
      const meetingPath = join(meetingsDir, entry.name + '.json');
      if (await (async () => { try { await readFile(meetingPath, 'utf8'); return true; } catch { return false; } })()) continue;
      const eventsRaw = await readFile(join(sessionDir, 'events.jsonl'), 'utf8').catch(() => '');
      const chunks = new Map();
      for (const line of eventsRaw.split('\n')) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (!['transcript', 'translation'].includes(event.type)) continue;
        const key = `${event.source || ''}:${event.chunkId ?? event.seq}`;
        const previous = chunks.get(key) || {};
        const offset = Number(event.offset ?? previous.offset);
        const length = Number(event.length ?? previous.length);
        chunks.set(key, {
          ...previous,
          start: Number(event.timestamp) / 1000 || previous.start || 0,
          end: Number(event.timestamp) / 1000 || previous.end || 0,
          speaker: event.speaker || previous.speaker || event.source || '',
          text: event.type === 'transcript' ? event.text || previous.text || '' : event.transcript || previous.text || '',
          source: event.source || previous.source || '',
          offset: Number.isFinite(offset) ? offset : previous.offset,
          length: Number.isFinite(length) ? length : previous.length,
          audioStart: Number.isFinite(offset) ? offset / 2 / 16000 : (previous.audioStart ?? null),
          audioEnd: Number.isFinite(offset) ? (offset + (Number.isFinite(length) ? length : 0)) / 2 / 16000 : (previous.audioEnd ?? null),
        });
      }
      const segments = [...chunks.values()].sort((a, b) => (a.start || 0) - (b.start || 0));
      const transcript = segments.map((segment) => segment.text).filter(Boolean).join('\n');
      if (!transcript) continue;
      const firstText = segments.find((segment) => segment.text)?.text || '';
      const record = this.withSimplified({
        id: entry.name,
        title: firstText ? firstText.slice(0, 48) : 'Live meeting ' + (checkpoint.startedAt || ''),
        createdAt: checkpoint.startedAt || '',
        updatedAt: nowIso(),
        duration: checkpoint.durationSeconds || 0,
        transcript,
        segments,
        audioSize: Number(checkpoint.metrics?.audioBytes) || 0,
        realtime: true,
        source: 'AI Minutes',
      });
      await mkdir(meetingsDir, { recursive: true });
      await writeFile(meetingPath, JSON.stringify(record, null, 2), 'utf8');
      recovered += 1;
    }
    return { recovered };
  }

  /* ----------------------------- voice book --------------------------- */

  async voiceProfilesPath() {
    return join(this.config.dataDir, 'voices', 'profiles.json');
  }

  voiceProfileBackupsDir() {
    return join(this.config.dataDir, 'voices', 'backups');
  }

  async loadVoiceProfiles() {
    return this.withVoiceLibraryLock(() => this.loadVoiceProfilesUnlocked());
  }

  async loadVoiceProfilesUnlocked() {
    const parse = (raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.profiles) ? parsed.profiles : null;
      } catch {
        return null;
      }
    };
    const primary = parse(await readFile(await this.voiceProfilesPath(), 'utf8').catch(() => ''));
    if (primary) {
      // Migrate a library written by an older plugin version the first time it
      // is read. Later reads see the snapshot and stay read-only.
      const existing = await readdir(this.voiceProfileBackupsDir()).catch(() => []);
      if (!existing.some((name) => /^profiles-.*\.json$/.test(name))) {
        await this.saveVoiceProfilesUnlocked(primary);
      }
      return primary;
    }
    // Voice identities are permanent. If the main file is lost or damaged,
    // recover the newest complete snapshot instead of silently starting over.
    const backups = (await readdir(this.voiceProfileBackupsDir()).catch(() => []))
      .filter((name) => /^profiles-.*\.json$/.test(name))
      .map((name) => ({
        name,
        revision: Number(/^profiles-(\d{12})-/.exec(name)?.[1]) || 0,
      }))
      .sort((left, right) => right.revision - left.revision || right.name.localeCompare(left.name));
    for (const { name } of backups) {
      const recovered = parse(await readFile(join(this.voiceProfileBackupsDir(), name), 'utf8').catch(() => ''));
      if (recovered) return recovered;
    }
    return [];
  }

  async saveVoiceProfiles(profiles) {
    return this.withVoiceLibraryLock(() => this.saveVoiceProfilesUnlocked(profiles));
  }

  async saveVoiceProfilesUnlocked(profiles) {
    const directory = join(this.config.dataDir, 'voices');
    const backups = this.voiceProfileBackupsDir();
    await mkdir(backups, { recursive: true });
    const contents = JSON.stringify({ profiles }, null, 2);
    const existing = (await readdir(backups).catch(() => []))
      .filter((name) => /^profiles-.*\.json$/.test(name));
    const revision = existing.reduce((highest, name) => Math.max(
      highest, Number(/^profiles-(\d{12})-/.exec(name)?.[1]) || 0,
    ), existing.length) + 1;
    // Revisions, not random ids, determine recovery order even for several
    // writes in one millisecond. The independent snapshot is written first.
    const backupName = `profiles-${String(revision).padStart(12, '0')}-${nowIso().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    await writeFile(join(backups, backupName), contents, { encoding: 'utf8', flag: 'wx' });
    const temporary = join(directory, `.profiles-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, contents, 'utf8');
      await rename(temporary, await this.voiceProfilesPath());
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return profiles;
  }

  /**
   * Point a voice profile at a short excerpt of the meeting it was heard in,
   * so the voice book can play the voice back. The excerpt is timed inside
   * the track that holds it, not on the wall clock.
   */
  _attachVoiceSample(profile, speaker, options = {}) {
    const segments = Array.isArray(options.segments) ? options.segments : [];
    const meetingId = String(options.meetingId || '');
    if (!profile || !meetingId) return;
    const segment = segments.find((item) => item.speaker === speaker);
    if (!segment) return;
    // A live track is timed from the start of the recording, an imported
    // recording from the start of the meeting.
    const live = Boolean(segment.source);
    const start = live ? Number(segment.audioStart) : Number(segment.start);
    const end = live ? Number(segment.audioEnd) : Number(segment.end);
    if (!Number.isFinite(start) || start < 0) return;
    const track = String(segment.source || '');
    profile.sample = {
      meetingId,
      track: track === 'system' ? 'system' : track === 'mic' ? 'mic' : '',
      start,
      end: Number.isFinite(end) && end > start ? end : start + 3,
    };
  }

  /** Match voiceprints against the global voice book and create entries for unknown voices. */
  async resolveVoiceLabels(voiceprints, existingLabels = {}, options = {}) {
    return this.withVoiceLibraryLock(() => this.resolveVoiceLabelsUnlocked(voiceprints, existingLabels, options));
  }

  async resolveVoiceLabelsUnlocked(voiceprints, existingLabels = {}, options = {}) {
    const profiles = await this.loadVoiceProfilesUnlocked();
    const threshold = Number(this.config.voiceMatchThreshold) || 0.5;
    const labels = { ...(existingLabels || {}) };
    const mapping = {};
    const assigned = new Set();
    for (const [speaker, embedding] of Object.entries(voiceprints || {})) {
      if (!Array.isArray(embedding) || !embedding.length) continue;
      let best = null;
      let bestScore = 0;
      for (const profile of profiles) {
        // Diarization clusters are distinct people within this meeting. Never
        // assign two clusters to one global identity or train it with both.
        if (assigned.has(profile.id)) continue;
        const candidates = [profile.embedding, ...(Array.isArray(profile.exemplars) ? profile.exemplars : [])]
          .filter((value) => Array.isArray(value) && value.length);
        const score = candidates.reduce((best2, candidate) => Math.max(best2, cosineSimilarity(embedding, candidate)), 0);
        if (score > bestScore) {
          bestScore = score;
          best = profile;
        }
      }
      if (best && bestScore >= threshold) {
        mapping[speaker] = best.id;
        assigned.add(best.id);
        if (best.name) labels[speaker] = best.name;
        best.exemplars = [...(Array.isArray(best.exemplars) ? best.exemplars : []), embedding].slice(-5);
        best.embedding = averageVector([best.embedding, embedding]);
        best.updatedAt = nowIso();
        this._attachVoiceSample(best, speaker, options);
        continue;
      }
      const baseId = voiceProfileId(embedding);
      let id = baseId;
      let profile = assigned.has(id) ? null : profiles.find((item) => item.id === id);
      if (!profile) {
        let suffix = 2;
        while (profiles.some((item) => item.id === id)) id = `${baseId}-${suffix++}`;
        profile = { id, name: '', embedding, exemplars: [embedding], createdAt: nowIso(), updatedAt: nowIso() };
        profiles.push(profile);
      }
      mapping[speaker] = id;
      assigned.add(id);
      this._attachVoiceSample(profile, speaker, options);
    }
    await this.saveVoiceProfilesUnlocked(profiles);
    return { labels, profiles: mapping, known: profiles };
  }

  /** Name one speaker of a meeting and remember the voice in the global voice book. */
  async labelVoice(payload = {}) {
    const meetingId = String(payload.meetingId || '');
    const speaker = String(payload.speaker || '');
    if (meetingId.startsWith('realtime-') && speaker) {
      const record = await this.readMeetingRecord(meetingId);
      const embedding = record?.voiceprints?.[speaker];
      if (record && (!Array.isArray(embedding) || !embedding.length)) {
        // Older meetings stored Speaker labels before they stored voiceprints.
        // Rebuild them from the retained tracks before taking the library lock.
        const labelled = await this.labelLiveSpeakers(record, { maxSeconds: null }).catch(() => null);
        if (Array.isArray(labelled?.voiceprints?.[speaker]) && labelled.voiceprints[speaker].length) {
          await this.writeMeetingRecord({
            ...record,
            segments: labelled.segments,
            voiceprints: labelled.voiceprints,
          });
        }
      }
    }
    return this.withVoiceLibraryLock(() => this.labelVoiceUnlocked(payload));
  }

  async labelVoiceUnlocked(payload = {}) {
    const meetingId = String(payload.meetingId || '');
    const speaker = String(payload.speaker || '');
    const name = String(payload.name || '').trim();
    if (!meetingId || !speaker) return fail('minutes/voice-missing', '缺少会议或说话人标识');
    const record = await this.readMeetingRecord(meetingId);
    if (!record) return fail('minutes/not-found', '没有找到会议：' + meetingId);
    const embedding = (record.voiceprints || {})[speaker];
    if (!Array.isArray(embedding) || !embedding.length) {
      return fail('minutes/voiceprint-missing', '该说话人没有可用声纹，无法用于后续会议识别；请先重新分离说话人');
    }
    const profiles = await this.loadVoiceProfilesUnlocked();
    const associatedId = String((record.speakerProfiles || {})[speaker] || '');
    const associated = profiles.find((item) => item.id === associatedId);
    // An unnamed auto-created profile can be named in place. Changing an
    // already-named identity is a reassignment, not a global rename: the old
    // person and every historical meeting that uses them must stay untouched.
    let profile = associated && (!associated.name || associated.name === name) ? associated : null;
    let profileId = profile ? associatedId : '';
    if (!profile && name) {
      profile = profiles.find((item) => item.id !== associatedId && item.name === name) || null;
      if (profile) profileId = profile.id;
    }
    if (!profile) {
      const baseId = voiceProfileId(embedding);
      profile = profiles.find((item) => item.id === baseId && item.id !== associatedId) || null;
      if (profile) {
        profileId = profile.id;
      } else {
        profileId = baseId;
        let suffix = 2;
        while (profiles.some((item) => item.id === profileId)) profileId = `${baseId}-${suffix++}`;
        profile = { id: profileId, name: '', embedding, exemplars: [], createdAt: nowIso(), updatedAt: nowIso() };
        profiles.push(profile);
      }
    }
    profile.name = name;
    profile.exemplars = [...(Array.isArray(profile.exemplars) ? profile.exemplars : []), embedding].slice(-5);
    profile.embedding = averageVector([profile.embedding, embedding]);
    profile.updatedAt = nowIso();
    const segments = Array.isArray(record.segments) ? record.segments : [];
    this._attachVoiceSample(profile, speaker, { segments, meetingId });
    await this.saveVoiceProfilesUnlocked(profiles);
    record.speakerLabels = { ...(record.speakerLabels || {}), [speaker]: name };
    record.speakerProfiles = { ...(record.speakerProfiles || {}), [speaker]: profileId };
    await this.writeMeetingRecord(record);
    return ok({
      speakerLabels: record.speakerLabels,
      speakerProfiles: record.speakerProfiles,
      profiles,
    });
  }

  /** Rename a voice in the global voice book and refresh every meeting that uses it. */
  async renameVoice(payload = {}) {
    return this.withVoiceLibraryLock(() => this.renameVoiceUnlocked(payload));
  }

  async renameVoiceUnlocked(payload = {}) {
    const profileId = String(payload.profileId || '');
    const name = String(payload.name || '').trim();
    if (!profileId) return fail('minutes/voice-missing', '缺少声音标识');
    const profiles = await this.loadVoiceProfilesUnlocked();
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return fail('minutes/not-found', '没有找到该声音');
    profile.name = name;
    profile.updatedAt = nowIso();
    await this.saveVoiceProfilesUnlocked(profiles);
    await this.applyProfileName(profileId, name);
    return ok({ profiles });
  }

  async applyProfileName(profileId, name) {
    if (!profileId) return;
    const names = await readdir(this.meetingsDir()).catch(() => []);
    for (const file of names.filter((item) => item.endsWith('.json'))) {
      const record = await this.readMeetingRecord(file.replace(/\.json$/, ''));
      if (!record || !record.speakerProfiles) continue;
      let changed = false;
      for (const [speaker, id] of Object.entries(record.speakerProfiles)) {
        if (id !== profileId) continue;
        record.speakerLabels = { ...(record.speakerLabels || {}), [speaker]: name };
        changed = true;
      }
      if (changed) await this.writeMeetingRecord(record);
    }
  }

  async readMeetingRecord(id) {
    const raw = await readFile(join(this.meetingsDir(), id + '.json'), 'utf8').catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeMeetingRecord(record) {
    await mkdir(this.meetingsDir(), { recursive: true });
    await writeFile(join(this.meetingsDir(), record.id + '.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  /* --------------------------- meeting library ----------------------- */

  async listMeetings() {
    try {
      await mkdir(this.meetingsDir(), { recursive: true });
      const names = await readdir(this.meetingsDir());
      const items = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(this.meetingsDir(), name), 'utf8');
          const meeting = JSON.parse(raw);
          items.push({
            id: meeting.id || name.replace(/\.json$/, ''),
            title: meeting.title || '',
            createdAt: meeting.createdAt || '',
            duration: meeting.duration || 0,
            speakers: Array.from(new Set((meeting.segments || []).map((s) => s.speaker).filter(Boolean))),
            transcriptLength: (meeting.transcript || '').length,
            topicCount: (meeting.minutes?.topics || []).length,
            excerpt: meeting.minutes?.summary || (meeting.transcript || '').slice(0, 160),
            size: Number(meeting.audioSize) || 0,
            creator: meeting.creator || userInfo().username,
            favorite: Boolean(meeting.favorite),
            inProgress: false,
            liveStatus: '',
            hasMinutes: Boolean(meeting.minutes && Object.keys(meeting.minutes).length > 0),
          });
        } catch {
          /* 跳过损坏的文件 */
        }
      }
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return ok({ meetings: items });
    } catch (error) {
      return fail('minutes/list-failed', error instanceof Error ? error.message : String(error));
    }
  }

  /** Append one assistant exchange to the persisted assistant history. */
  async appendAssistantHistory(entry) {
    const directory = join(this.config.dataDir, 'assistant');
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'history.json');
    const raw = await readFile(path, 'utf8').catch(() => '[]');
    let history = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      history = [];
    }
    history.push(entry);
    await writeFile(path, JSON.stringify(history.slice(-200), null, 2), 'utf8');
    return history;
  }

  /** Merge a patch into an existing meeting record without dropping stored fields. */
  async updateMeeting(id, patch) {
    const path = join(this.meetingsDir(), id + '.json');
    const raw = await readFile(path, 'utf8').catch(() => null);
    const current = raw ? JSON.parse(raw) : {};
    return this.saveMeeting({ ...current, ...patch, id });
  }

  /** Collect stored meetings and realtime sessions with their transcripts and minutes. */
  async collectHistory(limit = 6) {
    const records = [];
    const names = await readdir(this.meetingsDir()).catch(() => []);
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      try {
        const raw = await readFile(join(this.meetingsDir(), name), 'utf8');
        const meeting = JSON.parse(raw);
        if (!meeting.transcript && !meeting.minutes) continue;
        records.push({
          id: meeting.id || name.replace(/\.json$/, ''),
          title: meeting.title || '',
          createdAt: meeting.createdAt || '',
          transcript: meeting.transcript || '',
          minutes: meeting.minutes || null,
        });
      } catch {
        /* 跳过损坏的文件 */
      }
    }
    if (this.liveManager) {
      const live = await listLiveMeetings(this.liveManager).catch(() => []);
      for (const item of live) {
        records.push({
          id: item.id,
          title: item.title || '',
          createdAt: item.createdAt || '',
          transcript: item.transcript || '',
          minutes: item.minutes || null,
        });
      }
    }
    records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return records.slice(0, Math.max(1, limit));
  }

  /** Answer a question with the transcripts and minutes of past meetings. */
  async askHistory(question, options = {}) {
    const text = String(question || '').trim();
    if (!text) return fail('minutes/no-question', '缺少问题');
    const scope = options.scope === 'current' ? 'current' : 'all';
    let records = [];
    if (scope === 'current' && options.meetingId) {
      const raw = await readFile(join(this.meetingsDir(), options.meetingId + '.json'), 'utf8').catch(() => null);
      if (raw) {
        try {
          const meeting = JSON.parse(raw);
          records = [{
            id: meeting.id || options.meetingId,
            title: meeting.title || '',
            createdAt: meeting.createdAt || '',
            transcript: meeting.transcript || '',
            minutes: meeting.minutes || null,
          }];
        } catch {
          records = [];
        }
      }
    } else {
      records = await this.collectHistory(Math.max(1, Math.min(12, Number(options.limit) || 6)));
    }
    if (!records.length) {
      const answer = '暂时没有可用于回答的历史会议纪要。';
      await this.appendAssistantHistory({
        question: text, answer, scope, meetingId: options.meetingId || '', sources: [], createdAt: nowIso(),
      });
      return ok({ answer, sources: [] });
    }
    const context = records.map((record) => {
      const summary = record.minutes?.summary || '';
      const body = String(record.transcript || '').slice(0, 4000);
      return `### ${record.title || '未命名会议'}（${record.createdAt || '未知日期'}）\n纪要摘要：${summary}\n逐字稿：${body}`;
    }).join('\n\n');
    const prompt = [
      '你是会议知识助手。下面是本机历史会议的逐字稿与纪要摘要。',
      '请只依据这些资料回答问题，引用涉及的会议标题，并给出明确可执行的下一步工作建议。',
      '资料不足时直接说明缺少哪些信息，不要编造。',
      '',
      '历史会议资料：',
      context,
      '',
      `问题：${text}`,
    ].join('\n');
    const result = await this.chatWithFallback([{ role: 'user', content: prompt }], { provider: 'llm', temperature: 0.2 });
    if (!result.ok) return result;
    const sources = records.map((record) => ({ id: record.id, title: record.title, createdAt: record.createdAt }));
    await this.appendAssistantHistory({
      question: text,
      answer: result.result.text,
      scope,
      meetingId: options.meetingId || '',
      sources,
      createdAt: nowIso(),
    });
    if (scope === 'current' && options.meetingId) {
      const existing = await this.readMeetingField(options.meetingId, 'assistantHistory');
      const list = Array.isArray(existing) ? existing : [];
      await this.updateMeeting(options.meetingId, {
        assistantHistory: [
          ...list,
          { question: text, answer: result.result.text, createdAt: nowIso() },
        ],
      });
    }
    return ok({ answer: result.result.text, sources });
  }

  /** Read one field of a stored meeting record. */
  async readMeetingField(id, field) {
    const raw = await readFile(join(this.meetingsDir(), id + '.json'), 'utf8').catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw)?.[field] ?? null;
    } catch {
      return null;
    }
  }

  async saveMeeting(meeting) {
    if (!meeting || !meeting.title) return fail('minutes/no-title', '会议标题不能为空');
    const id = meeting.id || 'meeting-' + Date.now();
    let audioSize = Number(meeting.audioSize) || 0;
    if (!audioSize && meeting.audioId) {
      const names = await readdir(this.audioDir()).catch(() => []);
      const filename = names.find((name) => name.startsWith(meeting.audioId + '.'));
      if (filename) audioSize = (await stat(join(this.audioDir(), filename))).size;
    }
    const existingRaw = await readFile(join(this.meetingsDir(), id + '.json'), 'utf8').catch(() => null);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    const voiceprints = meeting.voiceprints || existing?.voiceprints || null;
    let speakerLabels = meeting.speakerLabels || existing?.speakerLabels || {};
    let speakerProfiles = meeting.speakerProfiles || existing?.speakerProfiles || {};
    const merged = { ...(existing || {}), ...meeting };
    if ((!Array.isArray(merged.segments) || merged.segments.length === 0) && Array.isArray(existing?.segments) && existing.segments.length) {
      merged.segments = existing.segments;
    }
    if (voiceprints && Object.keys(voiceprints).length && !Object.keys(speakerLabels).length) {
      const resolved = await this.resolveVoiceLabels(voiceprints, existing?.speakerLabels || {}, {
        segments: merged.segments,
        meetingId: id,
      });
      speakerLabels = resolved.labels;
      speakerProfiles = resolved.profiles;
    }
    if (!merged.transcript && existing?.transcript) merged.transcript = existing.transcript;
    if (!merged.minutes && existing?.minutes) merged.minutes = existing.minutes;
    const record = this.withSimplified({
      ...merged,
      audioSize,
      id,
      voiceprints: voiceprints || undefined,
      speakerLabels,
      speakerProfiles,
      createdAt: existing?.createdAt || meeting.createdAt || nowIso(),
      updatedAt: nowIso(),
    });
    await mkdir(this.meetingsDir(), { recursive: true });
    await writeFile(join(this.meetingsDir(), id + '.json'), JSON.stringify(record, null, 2), 'utf8');
    return ok({ meeting: record });
  }

  async getMeeting(id) {
    if (!id) return fail('minutes/no-id', '缺少会议 ID');
    try {
      const raw = await readFile(join(this.meetingsDir(), id + '.json'), 'utf8');
      return ok({ meeting: JSON.parse(raw) });
    } catch (error) {
      return fail('minutes/not-found', '没有找到会议：' + id);
    }
  }

  async deleteMeeting(id) {
    if (!id) return fail('minutes/no-id', '缺少会议 ID');
    if (!/^(?:realtime|meeting|audio|live)-[A-Za-z0-9-]+$/.test(id)) return fail('minutes/invalid-id', '会议 ID 无效');
    try {
      await this.ensureSettings();
      const meetingPath = join(this.meetingsDir(), id + '.json');
      const savedExists = await pathExists(meetingPath);
      let audioDeleted = false;
      if (savedExists) {
        const meeting = JSON.parse(await readFile(meetingPath, 'utf8'));
        await rm(meetingPath);
        if (typeof meeting.audioId === 'string' && /^audio-[A-Za-z0-9-]+$/.test(meeting.audioId)) {
          const directory = this.audioDir();
          const names = await readdir(directory).catch(() => []);
          for (const name of names) {
            if (!name.startsWith(meeting.audioId + '.')) continue;
            await rm(join(directory, name));
            audioDeleted = true;
          }
        }
      }
      let realtimeDeleted = false;
      if (/^realtime-[A-Za-z0-9-]+$/.test(id)) {
        const realtimePath = join(this.config.dataDir, 'realtime', id);
        if (await pathExists(realtimePath)) {
          await rm(realtimePath, { recursive: true, force: true });
          realtimeDeleted = true;
        }
      }
      audioDeleted = audioDeleted || realtimeDeleted;
      if (!savedExists && !realtimeDeleted && !audioDeleted) return fail('minutes/not-found', '没有找到会议：' + id);
      return ok({ deleted: id, realtimeDeleted, audioDeleted });
    } catch (error) {
      return fail('minutes/delete-failed', error instanceof Error ? error.message : String(error));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

export function apply(ctx, options = {}) {
  const service = new MinutesService({});
  // The service replaces its config object on every write, so the admin reads it live.
  const asrAdmin = options.asrAdmin || new AsrAdmin({ config: () => service.config });
  const liveSummaryCache = new Map();
  const liveFinalizeState = new Map();
  const openPath = options.openPath || (async (target) => {
    if (process.platform === 'darwin') {
      await run('open', [target], { timeout: 8000 });
      return true;
    }
    return false;
  });
  // The live manager is built after the overlay, so the overlay's control
  // handler reads it lazily instead of capturing a second one.
  let liveManager = options.liveManager || null;
  // The native window follows the host theme; the page tells the Host which
  // theme the shell is in.
  let overlayTheme = options.overlayTheme || 'light';
  const desktopOverlay = options.desktopOverlay || new DesktopOverlay({
    appearance: overlayAppearance(service.config, overlayTheme),
    // The overlay remembers the window size and place the reader chose.
    statePath: join(service.config.dataDir || '', 'overlay-window.json'),
    onControl: (detail) => handleOverlayControl(detail),
  });
  if (typeof desktopOverlay.setControlHandler === 'function') {
    desktopOverlay.setControlHandler((detail) => handleOverlayControl(detail));
  }
  liveManager = liveManager || createLiveManager(service, {
    ...options,
    onEvent: async (event) => {
      if (options.onEvent) await options.onEvent(event);
      await desktopOverlay.send(event);
      if (event?.type === 'status' && event?.detail === 'recording') {
        await announceOverlaySession();
      }
    },
    onLevel: async ({ source, level }) => {
      await desktopOverlay.send({ type: 'level', level, source });
    },
  });
  service.liveManager = liveManager;
  ctx.provide('minutes', service);
  void service.recoverMeetings().catch(() => {});
  if (service.config.asrAutoStart) void asrAdmin.start().catch(() => {});
  ctx.effect?.(() => async () => {
    const session = liveManager?._session;
    if (session && ['recording', 'stopping'].includes(session.status)) {
      await liveManager.stop(session.id).catch(() => {});
    }
    await desktopOverlay.stop().catch(() => {});
    return undefined;
  }, 'ai-minutes: stop live capture on dispose');

  /** Point the overlay's elapsed clock at the running live session. */
  async function announceOverlaySession(session = liveManager?._session) {
    const startedAt = Date.parse(String(session?.startedAt || ''));
    if (!Number.isFinite(startedAt)) return;
    await desktopOverlay.send({ type: 'session', startedAt });
  }

  /** Tell the overlay whether the session is live and whether transcription is paused. */
  async function sendOverlayState(session = liveManager?._session, options = {}) {
    const live = Boolean(session && ['recording', 'stopping'].includes(session.status));
    await desktopOverlay.send({
      type: 'state',
      paused: Boolean(session?.transcriptionPaused),
      live,
      stopping: Boolean(options.stopping),
      language: String(session?.targetLanguage || ''),
      languages: LIVE_TARGET_LANGUAGES,
    });
  }

  /** Push the configured look to the overlay; the window may still be closed. */
  async function sendOverlayAppearance() {
    const appearance = overlayAppearance(service.config, overlayTheme);
    if (typeof desktopOverlay.updateAppearance === 'function') {
      await desktopOverlay.updateAppearance(appearance);
      return;
    }
    await desktopOverlay.send({ type: 'appearance', ...appearance });
  }

  /** Re-send the look after the settings changed, but only to a running overlay. */
  async function refreshOverlayAppearance() {
    const open = typeof desktopOverlay.isOpen === 'function' ? desktopOverlay.isOpen() : false;
    if (!open) return;
    await sendOverlayAppearance();
  }

  /** Open the overlay with the look the settings ask for. */
  async function openOverlay() {
    await service.ensureSettings().catch(() => {});
    await sendOverlayAppearance();
    await desktopOverlay.start();
  }

  /** Close the overlay after the reader has had time to see the result. */
  function closeOverlayLater(delay = 3500) {
    const timer = setTimeout(() => {
      void desktopOverlay.stop().catch(() => {});
    }, delay);
    timer.unref?.();
  }

  /** Show the end-of-meeting progress in the floating window. */
  async function notifyOverlay(phase, text) {
    await desktopOverlay.send({ type: 'notice', phase, text }).catch(() => {});
  }

  /** End the live session and land it in the library, like the UI's End meeting. */
  async function stopLiveSession(sessionId, stopOptions = {}) {
    const manager = liveManager;
    if (!manager) throw new Error('minutes/live-unavailable');
    // Ending a meeting still has to drain the queue, finalize the transcript
    // and write the minutes, so the overlay shows that it is stopping instead
    // of vanishing at once.
    await sendOverlayState(manager._session, { stopping: true }).catch(() => {});
    const session = await manager.stop(sessionId);
    const status = await manager.status(sessionId, 0);
    const meeting = liveMeetingFromStatus(status);
    const finalized = await service.readMeetingRecord(meeting.id).catch(() => null);
    if (finalized?.finalTranscript?.length) {
      meeting.transcript = finalized.finalTranscript.map((segment) => segment.text).join('\n');
      meeting.segments = finalized.finalTranscript;
    }
    if (meeting?.transcript && !status?.session?.incognito) {
      // 说话人来自录音里真实的人，而不是采集音轨名（mic / system）。
      // 短录音当场分人；长录音放到后台，完成后写回会议记录。
      const trackSeconds = await service.realtimeTrackSeconds(meeting.id);
      const syncBudget = trackSeconds <= 300 ? 300 : null;
      let labelled = meeting;
      if (syncBudget !== null) {
        labelled = await service.labelLiveSpeakers(meeting, { maxSeconds: syncBudget }).catch(() => meeting);
      }
      await service.saveMeeting({
        id: meeting.id,
        title: meeting.title || 'Live meeting',
        createdAt: meeting.createdAt,
        duration: meeting.duration,
        transcript: meeting.transcript,
        segments: labelled.segments,
        voiceprints: labelled.voiceprints,
        minutes: meeting.minutes || undefined,
        audioSize: meeting.size,
        realtime: true,
        source: 'AI Minutes',
      });
      if (syncBudget === null) {
        void (async () => {
          try {
            const full = await service.labelLiveSpeakers(meeting, { maxSeconds: null });
            await service.updateMeeting(meeting.id, { segments: full.segments, voiceprints: full.voiceprints });
          } catch {
            /* keep the capture track labels when the clustering fails */
          }
        })();
      }
    }
    const worthSummarizing = meeting?.transcript && meeting.transcript.length >= 200 && Number(meeting.duration) >= 60;
    // Recording has stopped and the transcript is safely in the library. Keep
    // the window open only to explain what is happening to the minutes.
    await sendOverlayState(manager._session).catch(() => {});
    if (worthSummarizing && !status?.session?.incognito) {
      await notifyOverlay('working', '录音已结束，正在整理会议纪要…');
      void (async () => {
        try {
          const summary = await service.summarize(meeting.transcript, {
            title: meeting.title, date: meeting.createdAt, template: stopOptions.template,
          });
          if (summary.ok) {
            await service.updateMeeting(meeting.id, { minutes: summary.result.minutes });
            await notifyOverlay('ready', '会议纪要已就绪，可以在会议库中查看');
          } else {
            await notifyOverlay('ready', '录音已保存，可在会议详情页重新生成纪要');
          }
        } catch {
          await notifyOverlay('ready', '录音已保存，可在会议详情页重新生成纪要');
        } finally {
          closeOverlayLater(4200);
        }
      })();
    } else {
      await notifyOverlay('ready', status?.session?.incognito ? '录音已结束' : '录音已保存到会议库');
      closeOverlayLater(2800);
    }
    return { session, meeting };
  }

  /** React to the overlay's own pause / resume / stop buttons. */
  async function handleOverlayControl(detail, value = '') {
    const manager = liveManager;
    if (!manager) return;
    const session = manager._session;
    if (!session || !['recording', 'stopping'].includes(session.status)) return;
    const sessionId = session.id;
    try {
      if (detail === 'pause') {
        await manager.pauseTranscription(sessionId);
      } else if (detail === 'resume') {
        await manager.resumeTranscription(sessionId);
      } else if (detail === 'stop') {
        await stopLiveSession(sessionId);
      } else if (detail === 'language') {
        const language = String(value || '').trim();
        if (!LIVE_TARGET_LANGUAGES.includes(language)) return;
        // The next chunks are translated into the language the reader picked.
        session.targetLanguage = language;
        await manager._checkpoint?.();
      } else {
        return;
      }
    } catch (error) {
      console.warn('[ai-minutes] overlay control failed: ' + String(error));
    }
    await sendOverlayState().catch(() => {});
  }

  const handle = async (method, payload) => {
    switch (method) {
      case 'health':
        return ok(await service.health());
      case 'settings': {
        const settings = payload?.settings
          ? await service.writeSettings(payload.settings)
          : await service.readSettings();
        if (payload?.settings) await refreshOverlayAppearance().catch(() => {});
        return ok(settings);
      }
      case 'overlay-theme': {
        // The page knows which theme the shell is in; the native window has to
        // wear the same one, so it is told as soon as the theme changes.
        const theme = payload?.theme === 'dark' ? 'dark' : 'light';
        overlayTheme = theme;
        await sendOverlayAppearance().catch(() => {});
        return ok({ theme });
      }
      case 'transcribe':
        return service.transcribe(payload?.audio, payload?.options || {});
      case 'ask-history':
        return service.askHistory(payload?.question || payload?.text, payload?.options || {});
      case 'translate':
        return service.translate(payload?.text ?? payload?.transcript ?? '', payload?.options || {});
      case 'summarize':
        return service.summarize(payload?.transcript || '', payload?.context || {});
      case 'ask':
        return service.ask(payload?.transcript || '', payload?.question || '', payload?.context || {});
      case 'list': {
        const result = await service.listMeetings();
        if (!result.ok) return result;
        await service.ensureSettings();
        const realtime = await listLiveMeetings(liveManager);
        const meetings = new Map(realtime.map((meeting) => [meeting.id, {
          ...meeting,
          inProgress: ['recording', 'stopping'].includes(meeting.liveStatus),
          hasMinutes: Boolean(meeting.minutes && Object.keys(meeting.minutes).length > 0),
        }]));
        for (const meeting of result.result.meetings) meetings.set(meeting.id, meeting);
        return ok({ meetings: [...meetings.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) });
      }
      case 'get': {
        const saved = await service.getMeeting(payload?.id);
        try {
          const status = await liveManager.status(payload?.id, 0);
          const live = liveMeetingFromStatus(status);
          if (saved.ok) {
            // A meeting that is still recording has to say so, so its page can
            // offer to end the recording.
            return ok({
              meeting: {
                ...saved.result.meeting,
                liveStatus: live.liveStatus,
                inProgress: ['recording', 'stopping'].includes(live.liveStatus),
              },
            });
          }
          return ok({ meeting: live });
        } catch {
          return saved;
        }
      }
      case 'save':
        return service.saveMeeting(payload?.meeting);
      case 'delete':
        if (liveManager?._session?.id === payload?.id && ['recording', 'stopping'].includes(liveManager._session.status)) {
          await liveManager.stop(payload.id);
          await desktopOverlay.stop().catch(() => {});
        }
        return service.deleteMeeting(payload?.id);
      case 'voices':
        return ok({ profiles: await service.loadVoiceProfiles() });
      case 'audio-list':
        return ok({ files: await service.listMeetingAudio(payload?.id) });
      case 'audio-delete':
        return service.deleteMeetingAudio(payload || {});
      case 'voice-save':
        return service.labelVoice(payload || {});
      case 'voice-rename':
        return service.renameVoice(payload || {});
      case 'compare-translation':
        return service.compareTranslation(payload || {});
      case 'recover-meetings':
        return ok(await service.recoverMeetings());
      case 'templates':
        return ok({ templates: [...BUILTIN_TEMPLATES, ...(Array.isArray(service.config.templates) ? service.config.templates : [])] });
      case 'live-active': {
        const session = liveManager?._session;
        if (!session || !['recording', 'stopping'].includes(session.status)) return ok({ session: null, events: [] });
        try {
          const status = await liveManager.status(session.id, 0);
          return ok({ session: status.session || session, events: status.events || [] });
        } catch {
          return ok({ session, events: [] });
        }
      }
      case 'live-level': {
        // The loudness of the room right now. The capture measures the RMS of
        // every frame, so the page can move its ribbon with the voice.
        const session = liveManager?._session;
        const level = Number(session?.metrics?.audioLevel);
        const recording = Boolean(session && ['recording', 'stopping'].includes(session.status));
        return ok({
          level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
          recording,
          status: String(session?.status || ''),
        });
      }
      case 'live-finalize': {
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        const session = liveManager._session;
        if (!session) return fail('minutes/live-no-session', '没有正在进行的会议');
        liveFinalizeState.set(session.id, { pending: true, lastFinalAt: liveFinalizeState.get(session.id)?.lastFinalAt || '' });
        try {
          const result = await service.finalizeSession(session, { hotwords: payload?.hotwords });
          if (!result.ok) return result;
          if (typeof liveManager.applyFinalTranscript === 'function') {
            await liveManager.applyFinalTranscript(result.result.segments, { text: result.result.text });
          }
          await service.updateMeeting(session.id, {
            transcript: result.result.text,
            finalTranscript: result.result.segments,
            finalAt: nowIso(),
            segments: result.result.segments,
            voiceprints: result.result.voiceprints || undefined,
          });
          liveFinalizeState.set(session.id, { pending: false, lastFinalAt: nowIso() });
          return ok({ segments: result.result.segments, text: result.result.text, elapsed: result.result.elapsed });
        } catch (error) {
          liveFinalizeState.set(session.id, { pending: false, lastFinalAt: liveFinalizeState.get(session.id)?.lastFinalAt || '' });
          return fail('minutes/live-finalize-failed', error instanceof Error ? error.message : String(error));
        }
      }
      case 'live-summary-status': {
        const id = String(payload?.id || liveManager?._session?.id || '');
        const state = liveFinalizeState.get(id) || { pending: false, lastFinalAt: '' };
        const record = id ? await service.readMeetingRecord(id) : null;
        return ok({
          pending: Boolean(state.pending),
          lastFinalAt: record?.finalAt || state.lastFinalAt || '',
          finalCount: Array.isArray(record?.finalTranscript) ? record.finalTranscript.length : 0,
        });
      }
      case 'live-overlay-status':
        return ok({ open: typeof desktopOverlay.isOpen === 'function' ? desktopOverlay.isOpen() : false });
      case 'live-summary': {
        if (!liveManager?._session) return ok({ summary: null });
        const id = liveManager._session.id;
        const status = await liveManager.status(id, 0).catch(() => ({ session: liveManager._session, events: [] }));
        const transcript = (status.events || [])
          .filter((event) => event.type === 'transcript')
          .map((event) => event.text || '')
          .filter(isMeaningfulLine)
          .join('\n');
        if (transcript.length < LIVE_SUMMARY_MIN_CHARS) return ok({ summary: null, transcriptLength: transcript.length });
        const language = String(payload?.language || '').trim();
        const cacheKey = id + '|' + language;
        const cached = liveSummaryCache.get(cacheKey);
        const now = Date.now();
        const forced = payload?.force === true;
        if (!forced && cached && transcript.length < cached.transcriptLength * (1 + LIVE_SUMMARY_GROWTH) && now - cached.at < 120000) {
          return ok({ summary: cached.summary, generatedAt: cached.generatedAt, transcriptLength: cached.transcriptLength, cached: true });
        }
        const title = (status.events || []).find((event) => event.type === 'transcript')?.text?.slice(0, 40) || 'Live meeting';
        const result = await service.summarize(transcript.slice(-24000), {
          title, date: liveManager._session.startedAt, template: payload?.template, language,
        });
        if (!result.ok) return result;
        const entry = { summary: result.result.minutes, generatedAt: nowIso(), transcriptLength: transcript.length, at: now };
        liveSummaryCache.set(cacheKey, entry);
        return ok({ summary: entry.summary, generatedAt: entry.generatedAt, transcriptLength: entry.transcriptLength });
      }
      case 'live-mark':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          return ok({ session: await liveManager.mark(payload?.id, payload || {}) });
        } catch (error) {
          return fail('minutes/live-mark-failed', error instanceof Error ? error.message : String(error));
        }
      case 'list-models':
        return service.listModels(payload?.options || {});
      case 'asr-status':
        return ok(await asrAdmin.status());
      case 'asr-start':
        return ok(await asrAdmin.start());
      case 'asr-stop':
        return ok(await asrAdmin.stop());
      case 'asr-restart':
        return ok(await asrAdmin.restart());
      case 'asr-models':
        return ok({ models: await asrAdmin.models() });
      case 'asr-download-model': {
        const result = await asrAdmin.downloadModel({ id: payload?.id, url: payload?.url, filename: payload?.filename });
        const id = String(payload?.id || '');
        if (id.startsWith('ggml-')) {
          if (!service.config.whisperCppModel) await service.writeSettings({ whisperCppModel: result.path });
        } else if (id === 'sensevoice') {
          await service.writeSettings({ senseVoiceDir: result.path });
        } else if (id === 'fun-asr-nano') {
          await service.writeSettings({ funAsrDir: result.path });
        }
        return ok({ ...result, status: await asrAdmin.status() });
      }
      case 'open-path': {
        const target = String(payload?.path || '');
        if (!target) return fail('minutes/path-missing', '缺少路径');
        try {
          await openPath(target);
          return ok({ path: target });
        } catch (error) {
          return fail('minutes/path-open-failed', error instanceof Error ? error.message : String(error));
        }
      }
      case 'asr-delete-model': {
        const result = await asrAdmin.deleteModel({ id: payload?.id });
        if (!result.ok) return fail('minutes/asr-model-delete-failed', result.error || '删除失败');
        return ok(await asrAdmin.status());
      }
      case 'asr-select-model': {
        const selection = await asrAdmin.selectModel({ id: payload?.id, path: payload?.path });
        if (!selection.ok) {
          const code = selection.code === 'not-selectable'
            ? 'minutes/asr-model-not-selectable'
            : selection.code === 'missing' ? 'minutes/asr-model-missing' : 'minutes/asr-model-unknown';
          return fail(code, selection.error);
        }
        await service.writeSettings(selection.patch);
        return ok({ status: await asrAdmin.status(), settings: service.getSettings() });
      }
      case 'live-start':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          const startPayload = { ...(payload || {}) };
          if (payload?.incognito) startPayload.incognito = true;
          const session = await liveManager.start(startPayload);
          let overlayError = '';
          try {
            await openOverlay();
          } catch (error) {
            overlayError = error instanceof Error ? error.message : String(error);
          }
          await announceOverlaySession(session).catch(() => {});
          await sendOverlayState(session).catch(() => {});
          return ok({ session, overlayError });
        } catch (error) {
          return fail('minutes/live-start-failed', error instanceof Error ? error.message : String(error));
        }
      case 'live-status':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          return ok(await liveManager.status(payload?.id, payload?.after ?? 0));
        } catch (error) {
          return fail('minutes/live-status-failed', error instanceof Error ? error.message : String(error));
        }
      case 'live-pause':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          const session = await liveManager.pauseTranscription(payload?.id);
          await sendOverlayState().catch(() => {});
          return ok({ session });
        } catch (error) {
          return fail('minutes/live-pause-failed', error instanceof Error ? error.message : String(error));
        }
      case 'live-resume':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          const session = await liveManager.resumeTranscription(payload?.id);
          await sendOverlayState().catch(() => {});
          return ok({ session });
        } catch (error) {
          return fail('minutes/live-resume-failed', error instanceof Error ? error.message : String(error));
        }
      case 'live-overlay-open':
        try {
          await openOverlay();
          await announceOverlaySession().catch(() => {});
          await sendOverlayState().catch(() => {});
          return ok({ overlay: true });
        } catch (error) {
          return fail('minutes/live-overlay-failed', error instanceof Error ? error.message : String(error));
        }
      case 'live-stop':
        if (!liveManager) return fail('minutes/live-unavailable', '实时采集尚未就绪');
        try {
          return ok(await stopLiveSession(payload?.id, { template: payload?.template }));
        } catch (error) {
          return fail('minutes/live-stop-failed', error instanceof Error ? error.message : String(error));
        }
      default:
        return fail('minutes/unknown-method', '不支持的方法：' + method);
    }
  };

  ctx.inject(['commands'], (commandsCtx) => {
    commandsCtx.effect(() =>
      commandsCtx.commands.register({
        name: 'minutes-transcribe',
        description: '用本机 ASR 服务把会议音频转写成带说话人和时间戳的文字',
        input: { hint: '<json {audioBase64, filename, language?, hotwords?}>' },
        recordInput: false,
        handler: async ({ rawInput }) => {
          let payload;
          try {
            payload = JSON.parse(rawInput || '{}');
          } catch {
            return { kind: 'error', text: 'minutes-transcribe: 输入不是 JSON' };
          }
          const result = await handle('transcribe', payload);
          if (!result.ok) return { kind: 'error', text: 'minutes-transcribe: ' + result.error.message };
          return { kind: 'success', text: result.result.transcript };
        },
      }),
    );
    commandsCtx.effect(() =>
      commandsCtx.commands.register({
        name: 'minutes-summarize',
        description: '用本机对话模型把会议转写整理成结构化会议纪要（议题、章节、观点、决策、待办）',
        input: { hint: '<json {transcript, title?, date?}>' },
        recordInput: false,
        handler: async ({ rawInput }) => {
          let payload;
          try {
            payload = JSON.parse(rawInput || '{}');
          } catch {
            return { kind: 'error', text: 'minutes-summarize: 输入不是 JSON' };
          }
          const result = await handle('summarize', payload);
          if (!result.ok) return { kind: 'error', text: 'minutes-summarize: ' + result.error.message };
          return { kind: 'success', text: JSON.stringify(result.result.minutes) };
        },
      }),
    );
    commandsCtx.effect(() =>
      commandsCtx.commands.register({
        name: 'minutes-ask',
        description: '就一份会议转写提问，答案只依据转写内容',
        input: { hint: '<json {transcript, question, title?}>' },
        recordInput: false,
        handler: async ({ rawInput }) => {
          let payload;
          try {
            payload = JSON.parse(rawInput || '{}');
          } catch {
            return { kind: 'error', text: 'minutes-ask: 输入不是 JSON' };
          }
          const result = await handle('ask', payload);
          if (!result.ok) return { kind: 'error', text: 'minutes-ask: ' + result.error.message };
          return { kind: 'success', text: result.result.answer };
        },
      }),
    );
  });

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: AUDIO_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const bytes = Buffer.from(await request.arrayBuffer());
              if (bytes.length === 0) return Response.json(fail('minutes/empty-audio', '音频为空'), { status: 400 });
              const stored = await service.saveAudio(bytes, 'meeting.webm');
              return Response.json(ok(stored));
            } catch (error) {
              return Response.json(fail('minutes/upload-failed', error instanceof Error ? error.message : String(error)), { status: 200 });
            }
          },
        });
      } catch (error) {
        console.warn('[ai-minutes] audio route registration failed: ' + String(error));
        return () => {};
      }
    }, 'ai-minutes: ' + AUDIO_ROUTE);

    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: MEETING_AUDIO_ROUTE,
          methods: ['GET'],
          // Without a body mode the Host bridge builds a GET Request with a
          // body, which throws before this handler ever runs.
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              await service.ensureSettings();
              const id = String(new URL(request.url, 'http://localhost').searchParams.get('id') || '');
              if (!/^audio-[A-Za-z0-9-]+$/.test(id)) {
                return Response.json(fail('minutes/meeting-audio-id', '无效的音频 ID'), { status: 400 });
              }
              const directory = service.audioDir();
              const names = await readdir(directory);
              const filename = names.find((name) => name.startsWith(id + '.'));
              if (!filename) return Response.json(fail('minutes/meeting-audio-missing', '音频不存在'), { status: 404 });
              const path = join(directory, filename);
              const info = await stat(path);
              if (!info.isFile()) return Response.json(fail('minutes/meeting-audio-missing', '音频不存在'), { status: 404 });
              return audioRangeResponse(request, {
                size: info.size,
                type: audioContentType(filename),
                download: downloadName(request, filename),
                stream: (from, to) => createReadStream(path, {
                  start: from ?? 0,
                  end: to ?? Math.max(0, info.size - 1),
                }),
              });
            } catch (error) {
              const code = error?.code === 'ENOENT' ? 404 : 500;
              return Response.json(fail('minutes/meeting-audio-missing', error instanceof Error ? error.message : String(error)), { status: code });
            }
          },
        });
      } catch (error) {
        console.warn('[ai-minutes] meeting audio route registration failed: ' + String(error));
        return () => {};
      }
    }, 'ai-minutes: ' + MEETING_AUDIO_ROUTE);

    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: LIVE_AUDIO_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              await service.ensureSettings();
              const url = new URL(request.url, 'http://localhost');
              const id = String(url.searchParams.get('id') || '');
              const track = String(url.searchParams.get('track') || 'mic');
              if (!/^realtime-[A-Za-z0-9-]+$/.test(id)) {
                return Response.json(fail('minutes/live-audio-id', '无效的实时会话 ID'), { status: 400 });
              }
              if (!['mic', 'system', 'mix'].includes(track)) {
                return Response.json(fail('minutes/live-audio-track', '无效的音轨'), { status: 400 });
              }
              const directory = join(service.config.dataDir, 'realtime', id);
              const paths = Object.fromEntries(['mic', 'system'].map((name) => [name, join(directory, name + '.pcm')]));
              const infos = {};
              for (const [name, path] of Object.entries(paths)) {
                infos[name] = await stat(path).catch(() => null);
              }
              const present = Object.values(infos).filter((info) => info?.isFile());
              if (!present.length) return Response.json(fail('minutes/live-audio-missing', '音轨不存在'), { status: 404 });
              const pcmSize = track === 'mix'
                ? Math.max(...present.map((info) => info.size))
                : infos[track]?.size || 0;
              const header = pcmToWav(Buffer.alloc(0));
              header.writeUInt32LE(pcmSize + 36, 4);
              header.writeUInt32LE(pcmSize, 40);
              // The WAV is a header followed by raw PCM, so a byte range has
              // to be mapped back onto the track(s) behind the header.
              const stream = (from, to) => {
                const output = new PassThrough();
                const begin = from ?? 0;
                const finish = to ?? pcmSize + 43;
                if (begin < header.length) {
                  output.write(header.subarray(begin, Math.min(finish + 1, header.length)));
                }
                const pcmStart = Math.max(0, begin - header.length);
                const pcmEnd = Math.min(pcmSize - 1, finish - header.length);
                if (pcmEnd >= pcmStart) {
                  if (track === 'mix') {
                    mixedPcmStream(
                      infos.mic?.isFile() ? paths.mic : null,
                      infos.system?.isFile() ? paths.system : null,
                      { start: pcmStart, end: pcmEnd },
                    ).pipe(output);
                  } else {
                    createReadStream(paths[track], { start: pcmStart, end: pcmEnd }).pipe(output);
                  }
                } else {
                  output.end();
                }
                return output;
              };
              return audioRangeResponse(request, {
                size: pcmSize + header.length,
                type: 'audio/wav',
                download: downloadName(request, track === 'mix' ? 'meeting.wav' : track + '.wav'),
                stream,
              });
            } catch (error) {
              const code = error?.code === 'ENOENT' ? 404 : 500;
              return Response.json(fail('minutes/live-audio-missing', error instanceof Error ? error.message : String(error)), { status: code });
            }
          },
        });
      } catch (error) {
        console.warn('[ai-minutes] live audio route registration failed: ' + String(error));
        return () => {};
      }
    }, 'ai-minutes: ' + LIVE_AUDIO_ROUTE);

    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await request.json();
            } catch {
              return Response.json(fail('minutes/bad-request', '请求体不是 JSON'), { status: 400 });
            }
            const result = await handle(body?.method, body?.payload ?? {});
            return Response.json(result, { status: result.ok ? 200 : 200 });
          },
        });
      } catch (error) {
        console.warn('[ai-minutes] route registration failed: ' + String(error));
        return () => {};
      }
    }, 'ai-minutes: ' + ROUTE);
  });
}
