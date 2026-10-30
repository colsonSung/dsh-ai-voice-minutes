import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

/** The look the overlay starts with when the owner has not chosen one. */
export const DEFAULT_APPEARANCE = {
  background: '#f6f6f7',
  text: '#1c1c1e',
  opacity: 1,
  compact: true,
};

/** Owns the native always-on-top transcript window process. */
export class DesktopOverlay {
  constructor(options = {}) {
    this.command = options.command || fileURLToPath(new URL('./native/bin/floating-overlay', import.meta.url));
    this.args = options.args || [];
    this.process = null;
    this.appearance = { ...DEFAULT_APPEARANCE, ...(options.appearance || {}) };
    this.controlHandler = typeof options.onControl === 'function' ? options.onControl : null;
    // The overlay keeps the window size and place the reader chose.
    this.statePath = options.statePath || '';
  }

  /** Replace the handler that receives the overlay's own pause / resume / stop requests. */
  setControlHandler(handler) {
    this.controlHandler = typeof handler === 'function' ? handler : null;
    return this;
  }

  async start() {
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) return;
    const env = { ...process.env };
    if (this.statePath) env.AI_MINUTES_OVERLAY_STATE = this.statePath;
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    this.process = child;
    child.stderr.resume();
    this._readOutput(child);
    child.once('close', () => {
      if (this.process === child) this.process = null;
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        child.off('spawn', onSpawn);
        if (this.process === child) this.process = null;
        reject(error);
      };
      const onSpawn = () => {
        child.off('error', onError);
        resolve();
      };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
    child.stdin.write(JSON.stringify({ type: 'status', detail: 'desktop-overlay-ready' }) + '\n');
    await this.updateAppearance(this.appearance);
  }

  isOpen() {
    return Boolean(this.process && this.process.exitCode === null && !this.process.signalCode);
  }

  async send(event) {
    const child = this.process;
    if (!child || child.exitCode !== null || child.signalCode || !child.stdin.writable) return;
    child.stdin.write(JSON.stringify(event) + '\n');
  }

  /** Re-send the colours and the default layout to the running overlay. */
  async updateAppearance(appearance) {
    const next = { ...DEFAULT_APPEARANCE, ...(appearance || {}) };
    this.appearance = next;
    await this.send({ type: 'appearance', ...next });
  }

  async stop() {
    const child = this.process;
    if (!child) return;
    this.process = null;
    if (child.exitCode !== null || child.signalCode) return;
    child.stdin.write(JSON.stringify({ type: 'control', detail: 'close' }) + '\n');
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 2000);
    timer.unref();
    await Promise.race([
      new Promise((resolve) => child.once('close', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    clearTimeout(timer);
  }

  /** Read the overlay's stdout as JSONL so its buttons can drive the plugin. */
  _readOutput(child) {
    const stdout = child.stdout;
    if (!stdout) return;
    const decoder = new StringDecoder('utf8');
    let buffered = '';
    stdout.on('error', () => {});
    stdout.on('data', (chunk) => {
      buffered += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const line of lines) this._handleLine(line);
    });
    stdout.on('end', () => {
      buffered += decoder.end();
      if (buffered.trim()) this._handleLine(buffered);
    });
  }

  /** One JSONL line from the overlay; anything malformed is ignored. */
  _handleLine(line) {
    const text = String(line || '').trim();
    if (!text) return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (!event || typeof event !== 'object' || event.type !== 'control') return;
    const detail = typeof event.detail === 'string' ? event.detail : '';
    if (!detail) return;
    // A control can carry a value, for example the language to translate into.
    const value = typeof event.value === 'string' ? event.value : '';
    void this._dispatchControl(detail, value);
  }

  /** A failing overlay action must never take the plugin down. */
  async _dispatchControl(detail, value = '') {
    const handler = this.controlHandler;
    if (!handler) return;
    try {
      await handler(detail, value);
    } catch (error) {
      console.warn('[ai-minutes] overlay control failed: ' + String(error));
    }
  }
}
