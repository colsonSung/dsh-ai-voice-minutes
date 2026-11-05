import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Where LM Studio ships its CLI. The bundled one is only reachable while the
 * app is installed; the copy in the home directory is created by `lms
 * bootstrap` and survives the app being moved.
 */
const LMS_CANDIDATES = [
  join(homedir(), '.lmstudio', 'bin', 'lms'),
  '/Applications/LM Studio.app/Contents/Resources/app/.webpack/lms',
];

/** A model that is already loaded is not loaded twice, and a load is bounded. */
const LOAD_TIMEOUT_MS = 300000;
const SERVER_TIMEOUT_MS = 60000;
const PROBE_TIMEOUT_MS = 2500;

function errorOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function trimBaseUrl(value) {
  return String(value || '').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
}

/**
 * Keeps the local model servers that the settings actually point at running.
 *
 * Two different things are called "local model" in this plugin, and both have
 * to be up before a meeting starts or the first caption arrives late:
 *
 *   - the transcription service (whisper.cpp / Fun-ASR), owned by AsrAdmin
 *   - the translation model, served by LM Studio's local server
 *
 * This class owns the second one. It starts the server and loads the model the
 * settings name, and it never touches a model that some other provider serves
 * — a cloud translation provider must not drag a 5 GB model into memory.
 */
export class LocalLlmAdmin {
  constructor(options = {}) {
    this.configSource = options.config || {};
    this.run = options.run || ((file, args, runOptions) => execFileAsync(file, args, {
      timeout: LOAD_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(runOptions || {}),
    }));
    this.fetchImpl = options.fetch || ((...args) => globalThis.fetch(...args));
    this.exists = options.exists || (async (file) => {
      try {
        await access(file);
        return true;
      } catch {
        return false;
      }
    });
    this.log = options.log || (() => {});
  }

  get config() {
    return typeof this.configSource === 'function' ? (this.configSource() || {}) : this.configSource;
  }

  /** The `lms` binary, or an empty string when LM Studio is not installed. */
  async lmsBinary() {
    const configured = String(this.config.lmLmsBinary || '').trim();
    if (configured) return configured;
    for (const candidate of LMS_CANDIDATES) {
      if (await this.exists(candidate)) return candidate;
    }
    return '';
  }

  /**
   * The local models the settings name. Only the primary provider of each role
   * counts: a fallback is loaded on demand when the primary actually fails,
   * not at boot, because loading it costs gigabytes of memory nobody asked for.
   */
  targets() {
    const config = this.config;
    const list = [];
    const add = (role, provider, baseUrl, model) => {
      if (String(provider || '') !== 'lmstudio') return;
      const name = String(model || '').trim();
      const base = trimBaseUrl(baseUrl);
      if (!name || !base) return;
      list.push({ role, model: name, baseUrl: base });
    };
    add('translation', config.translationProvider, config.translationBaseUrl, config.translationModel);
    add('llm', config.llmProvider, config.llmBaseUrl, config.llmModel);
    // One model may serve two roles; it only has to be loaded once.
    const seen = new Set();
    return list.filter((target) => {
      const key = target.model.toLowerCase() + '@' + target.baseUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Everything this admin needs to know, in the shape the panel renders.
   *
   * Readiness is residency, not availability: `/v1/models` lists every model on
   * disk, so it answers "yes" for a model that is not in memory and would make
   * the first translation wait for a multi-gigabyte load. `lms ps` is the only
   * honest source for "already loaded".
   */
  async status() {
    const targets = this.targets();
    const binary = await this.lmsBinary();
    const probes = await Promise.all(targets.map(async (target) => ({
      ...target,
      ...(await this.probe(target.baseUrl)),
    })));
    const resident = binary ? await this.loadedModels(binary).catch(() => []) : [];
    const isResident = (model) => resident.some((name) => name.toLowerCase() === String(model || '').toLowerCase());
    const resolved = probes.map((probe) => ({ ...probe, resident: isResident(probe.model) }));
    return {
      binary,
      installed: Boolean(binary),
      targets: resolved,
      online: resolved.length ? resolved.some((probe) => probe.online) : false,
      resident,
      loaded: resolved.filter((probe) => probe.resident).map((probe) => probe.model),
      ready: resolved.length ? resolved.every((probe) => probe.online && probe.resident) : true,
      autoStart: Boolean(this.config.llmAutoStart),
    };
  }

  /**
   * Ask the served model list whether the endpoint is up *and* whether it has
   * the model the settings name. An endpoint that answers without the model
   * would fail the first translation, which is exactly the case worth catching
   * before a meeting starts.
   */
  async probe(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(trimBaseUrl(baseUrl) + '/v1/models', { signal: controller.signal });
      if (!response.ok) return { online: false, available: false, models: [], detail: 'HTTP ' + response.status };
      const payload = await response.json().catch(() => ({}));
      const models = Array.isArray(payload?.data)
        ? payload.data.map((entry) => String(entry?.id || '')).filter(Boolean)
        : [];
      // `models` is what the endpoint *has on disk*, not what is in memory.
      return { online: true, models, available: models.length > 0 };
    } catch (error) {
      return { online: false, available: false, models: [], detail: errorOf(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** `lms ps --json` → the identifiers currently resident. */
  async loadedModels(binary) {
    const { stdout } = await this.run(binary, ['ps', '--json'], { timeout: 20000 });
    const raw = String(stdout || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => String(entry?.identifier || entry?.modelKey || ''))
      .filter(Boolean);
  }

  /** Start the server when it is down. Idempotent: LM Studio says so and exits 0. */
  async startServer(binary) {
    try {
      await this.run(binary, ['server', 'start'], { timeout: SERVER_TIMEOUT_MS });
      return { started: true };
    } catch (error) {
      // "already running" is the common case and is not a failure.
      const message = errorOf(error);
      if (/already\s+running|already started/i.test(message)) return { started: false, alreadyRunning: true };
      throw new Error('本地模型服务启动失败：' + message);
    }
  }

  async waitForServer(baseUrl, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = await this.probe(baseUrl);
      if (probe.online) return probe;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return this.probe(baseUrl);
  }

  /**
   * Bring every local target up: start the server if it is down, then load each
   * model that is not already resident. Never throws — the caller is a boot
   * hook, and a missing LM Studio must not take the host down with it.
   */
  async ensure() {
    const targets = this.targets();
    if (!targets.length) return { ok: true, skipped: 'no-local-provider', loaded: [], targets: [] };
    const binary = await this.lmsBinary();
    if (!binary) {
      return { ok: false, skipped: 'lms-missing', detail: '没有找到 LM Studio 的命令行工具 lms', loaded: [], targets };
    }
    const baseUrls = [...new Set(targets.map((target) => target.baseUrl))];
    const server = { started: false };
    try {
      const first = await this.probe(baseUrls[0]);
      if (!first.online) {
        Object.assign(server, await this.startServer(binary));
        await Promise.all(baseUrls.map((baseUrl) => this.waitForServer(baseUrl)));
      }
    } catch (error) {
      return { ok: false, skipped: 'server-failed', detail: errorOf(error), loaded: [], targets };
    }

    let resident = await this.loadedModels(binary).catch(() => []);
    const loaded = [];
    for (const target of targets) {
      const already = resident.some((name) => name.toLowerCase() === target.model.toLowerCase());
      if (already) {
        loaded.push({ ...target, loaded: false, alreadyLoaded: true });
        continue;
      }
      try {
        await this.run(binary, ['load', target.model], { timeout: LOAD_TIMEOUT_MS });
        loaded.push({ ...target, loaded: true });
      } catch (error) {
        loaded.push({ ...target, loaded: false, error: errorOf(error) });
      }
    }
    // Re-read rather than assume: the API is the truth the reader will hit.
    resident = await this.loadedModels(binary).catch(() => resident);
    const probes = await Promise.all(baseUrls.map((baseUrl) => this.probe(baseUrl)));
    return {
      ok: probes.every((probe) => probe.online),
      server,
      loaded,
      resident,
      targets,
    };
  }
}

export default LocalLlmAdmin;
