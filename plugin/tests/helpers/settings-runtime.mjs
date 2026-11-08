import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE_URL = new URL('../../client.js', import.meta.url);
const source = await readFile(SOURCE_URL, 'utf8');

/**
 * Read the shipped English dictionary straight out of the client module.
 *
 * The test host supplies the locale, so a hand-written map would drift from the
 * shipped one — and with a fallback to the raw key, any missing label shows up
 * as a literal "settings.xxx" instead of failing loudly.
 */
function extractEnglishDict(text) {
  const start = text.indexOf('      en: {');
  assert.ok(start > 0, 'the English dictionary exists');
  let depth = 0;
  let index = text.indexOf('{', start);
  const opened = index;
  for (; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === quote) break;
        index += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const literal = text.slice(opened, index + 1);
  return vm.runInNewContext('(' + literal + ')');
}

export const EN = extractEnglishDict(source);

export function createRenderer(React, hooks, beginFrame) {
  let pendingEffects = [];
  let root = null;
  let tree = null;
  function resolve(node) {
    if (node == null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
    if (Array.isArray(node)) return node.map(resolve);
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    if (node.type === React.Fragment) return resolve(node.props.children);
    return { ...node, props: { ...node.props, children: resolve(node.props.children) } };
  }
  function render() {
    if (!root) return;
    pendingEffects = [];
    beginFrame((index) => pendingEffects.push(index));
    tree = resolve(root);
    for (const index of pendingEffects) {
      const record = hooks[index];
      if (typeof record.cleanup === 'function') record.cleanup();
      record.cleanup = record.effect() || undefined;
    }
  }
  function visit(node, predicate, matches = []) {
    if (node == null || typeof node !== 'object') return matches;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, predicate, matches);
      return matches;
    }
    if (predicate(node)) matches.push(node);
    visit(node.props?.children, predicate, matches);
    return matches;
  }
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    return text(node.props?.children);
  }
  return {
    mount(element) { root = element; render(); },
    render,
    tree() { return tree; },
    text() { return text(tree); },
    findAll(predicate) { return visit(tree, predicate); },
    async click(label) {
      const button = visit(tree, (node) => node.type === 'button' && text(node).trim() === label)[0]
        || visit(tree, (node) => node.type === 'button' && node.props['aria-label'] === label)[0]
        || visit(tree, (node) => node.type === 'button' && text(node).includes(label))[0];
      assert.ok(button, 'button "' + label + '" exists');
      await button.props.onClick?.({ stopPropagation() {}, target: {} });
    },
    async fill(label, value) {
      const input = visit(tree, (node) => ['input', 'textarea', 'select'].includes(node.type)
        && (node.props['aria-label'] === label || node.props.placeholder === label))[0];
      assert.ok(input, 'field "' + label + '" exists');
      await input.props.onChange?.({ target: { value, checked: value } });
    },
  };
}

const CATALOG = {
  activeId: 'sensevoice',
  entries: [
    {
      id: 'ggml-large-v3-turbo.bin', label: 'Large v3 Turbo', backend: 'whispercpp', role: 'asr',
      capability: 'live', kind: 'file', sizeLabel: '1.6 GB', actualSize: 1703240704,
      downloaded: true, active: false, selectable: true,
    },
    {
      id: 'ggml-tiny.bin', label: 'Tiny', backend: 'whispercpp', role: 'asr',
      capability: 'live', kind: 'file', sizeLabel: '75 MB', actualSize: 78643200,
      downloaded: false, active: false, selectable: true,
    },
    {
      id: 'sensevoice', label: 'SenseVoice', backend: 'sensevoice', role: 'asr',
      capability: 'live', kind: 'tar.bz2', sizeLabel: '1.05 GB', actualSize: 239550000,
      downloaded: true, active: true, selectable: true,
    },
    {
      id: 'fun-asr-nano', label: 'Fun-ASR-Nano', backend: 'funasr', role: 'asr',
      capability: 'refine', kind: 'files', sizeLabel: '1.9 GB', actualSize: 1900000000,
      downloaded: true, active: false, refine: true, selectable: false,
    },
    {
      id: 'ecapa', label: 'ECAPA speaker model', backend: 'diarize', role: 'diarize',
      capability: 'diarize', kind: 'files', sizeLabel: '85 MB', actualSize: 89000000,
      downloaded: true, active: false, selectable: false,
    },
  ],
};

export function asrStatus(catalog = CATALOG) {
  return {
    catalog,
    live: { id: 'sensevoice', label: 'SenseVoice', backend: 'sensevoice', downloaded: true, size: 239550000 },
    refine: { id: 'fun-asr-nano', label: 'Fun-ASR-Nano', backend: 'funasr', downloaded: true, size: 1900000000, ready: true },
    online: true,
    endpoint: 'http://127.0.0.1:8010',
    health: { status: 'ok', backend: 'sensevoice' },
    models: [],
    modelDir: '/tmp/minutes-models',
    backend: 'sensevoice',
    asrBackend: 'sensevoice',
    launcher: '/tmp/local_services.py',
    autoStart: true,
  };
}

export function localModelsStatus() {
  return {
    binary: '/usr/local/bin/lms', installed: true,
    targets: [{ role: 'translation', model: 'hy-mt2-7b', baseUrl: 'http://127.0.0.1:6121' }],
    resident: ['hy-mt2-7b'], loaded: ['hy-mt2-7b'], online: true, ready: true, autoStart: true,
  };
}

export const defaultSettings = () => ({
  asrProvider: 'local', asrBaseUrl: 'http://127.0.0.1:8010', asrPath: '/v1/audio/transcriptions',
  asrModel: 'base', asrBackend: 'sensevoice', liveChunkSeconds: 3, asrAutoStart: true,
  llmProvider: 'lmstudio', llmBaseUrl: 'http://127.0.0.1:6121/v1', llmModel: 'qwen3.5-9b-mtp',
  llmTemperature: 0.2, llmMaxTokens: 4096, llmAutoStart: true,
  translationProvider: 'lmstudio', translationBaseUrl: 'http://127.0.0.1:6121/v1',
  translationModel: 'hy-mt2-7b', translationFallbackEnabled: true,
  translationFallbackProvider: 'lmstudio', translationFallbackModel: 'hy-mt2-7b',
  translationFallbackBaseUrl: 'http://127.0.0.1:6121/v1',
  overlayBackground: '#f6f6f7', overlayText: '#1c1c1e', overlayOpacity: 1, overlayCompact: true,
});

export function createRuntime(runtimeOptions = {}) {
  const requests = [];
  const listeners = [];
  let saved = { ...defaultSettings(), ...(runtimeOptions.settings || {}) };

  const resultFor = (method, payload) => {
    switch (method) {
      case 'health':
        return { settings: saved, asr: { alive: true }, llm: { alive: true } };
      case 'list':
        return { meetings: [] };
      case 'voices':
        return { profiles: [] };
      case 'asr-status':
        return asrStatus(runtimeOptions.catalog || CATALOG);
      case 'local-models-status':
        return localModelsStatus();
      case 'settings':
        saved = { ...saved, ...(payload?.settings || {}) };
        return saved;
      case 'asr-select-model':
        return { ok: true, settings: { ...saved, asrBackend: 'sensevoice' }, status: asrStatus() };
      case 'asr-download-model':
        return { ok: true, id: payload?.id, status: asrStatus() };
      default:
        return { ok: true, status: asrStatus() };
    }
  };

  const fetch = async (route, options) => {
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    const result = resultFor(method, payload);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }) };
  };

  const mediaElements = [];
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
    },
  };
  const hooks = [];
  let currentHook = 0;
  React.useState = (initial) => {
    const index = currentHook++;
    if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
    const setValue = (next) => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; };
    return [hooks[index].value, setValue];
  };
  React.useRef = (initial) => {
    const index = currentHook++;
    if (!hooks[index]) hooks[index] = { current: initial };
    return hooks[index];
  };
  React.useCallback = (callback) => { currentHook += 1; return callback; };
  React.useEffect = (effect, deps) => {
    const index = currentHook++;
    const previous = hooks[index];
    const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
      || deps.some((value, depIndex) => !Object.is(value, previous.deps[depIndex]));
    hooks[index] = { deps, effect, cleanup: previous?.cleanup };
    if (changed) React.__queueEffect(index);
  };
  const renderer = createRenderer(React, hooks, (queueEffect) => {
    currentHook = 0;
    React.__queueEffect = queueEffect;
  });

  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  const document = {
    body: { getAttribute: () => null, hasAttribute: () => false },
    documentElement: { getAttribute: () => null, hasAttribute: () => false },
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
    addEventListener(type, handler) { if (type === 'keydown') listeners.push(handler); },
    removeEventListener(type, handler) {
      if (type !== 'keydown') return;
      const index = listeners.indexOf(handler);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const context = {
    window, document, console, fetch, URLSearchParams,
    navigator: { language: 'en-US', clipboard: { writeText: async () => {} } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    setTimeout: (callback) => callback(),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context);

  let mainFactory;
  definition.factory(() => React).apply({
    effect: (register) => register(),
    locale: { bind: () => (key) => EN[key] || key, register: () => () => {} },
    slots: {
      inject: (name, register) => register(),
      register(options, factory) { if (options.name === 'main') mainFactory = factory; return () => {}; },
    },
  });
  return {
    renderer, requests, mediaElements, mainFactory,
    pressEscape: () => { for (const handler of [...listeners]) handler({ key: 'Escape' }); },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

/** Serialise a resolved React tree to HTML, for screenshotting the real markup. */
export function serialize(node, context = {}) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (Array.isArray(node)) return node.map((child) => serialize(child, context)).join('');
  const { type, props = {} } = node;
  const tag = typeof type === 'string' ? type : 'div';
  const attributes = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || typeof value === 'function' || value === undefined || value === null) continue;
    if (key === 'className') { attributes.push('class="' + String(value) + '"'); continue; }
    if (key === 'value') { attributes.push('value="' + String(value) + '"'); continue; }
    if (key === 'checked') { if (value) attributes.push('checked'); continue; }
    if (key === 'disabled') { if (value) attributes.push('disabled'); continue; }
    if (key === 'selected') { if (value) attributes.push('selected'); continue; }
    if (key === 'tabIndex' || key === 'key' || key === 'ref' || key === 'fill') continue;
    if (typeof value === 'object') continue;
    attributes.push(key + '="' + String(value).replace(/"/g, '&quot;') + '"');
  }
  // A select renders its own value, not the DOM state; mark the matching option
  // so a screenshot shows the model that is actually selected.
  if (tag === 'option' && context.selected !== undefined && String(props.value) === String(context.selected)) {
    attributes.push('selected');
  }
  const childContext = tag === 'select' ? { selected: props.value } : context;
  const voidTags = new Set(['img', 'input', 'br', 'hr', 'path', 'circle', 'rect']);
  const open = '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>';
  if (voidTags.has(tag)) return open;
  return open + serialize(props.children, childContext) + '</' + tag + '>';
}
