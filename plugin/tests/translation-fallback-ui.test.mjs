import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function createRenderer(React, hooks, beginFrame, mediaElements) {
  let pendingEffects = [];
  let root = null;
  let tree = null;
  function resolve(node) {
    if (node == null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
    if (Array.isArray(node)) return node.map(resolve);
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    if (node.type === React.Fragment) return resolve(node.props.children);
    const resolved = { ...node, props: { ...node.props, children: resolve(node.props.children) } };
    if (node.type === 'audio' && node.props?.ref) {
      if (!node.props.ref.current) {
        const element = {
          src: node.props.src || '', paused: true, currentTime: 0, duration: 3600,
          playCalls: 0, pauseCalls: 0, loadCalls: 0, playbackRate: 1,
          play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
          pause() { this.pauseCalls += 1; this.paused = true; },
          load() { this.loadCalls += 1; this.paused = true; },
          removeAttribute(name) { if (name === 'src') this.src = ''; },
        };
        node.props.ref.current = element;
        mediaElements.push(element);
      } else node.props.ref.current.src = node.props.src || '';
    }
    return resolved;
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
    unmount() { for (const record of hooks) if (typeof record.cleanup === 'function') record.cleanup(); root = null; tree = null; },
    text() { return text(tree); },
    findAll(predicate) { return visit(tree, predicate); },
    async click(label) {
      const button = visit(tree, (node) => node.type === 'button' && text(node).trim() === label)[0]
        || visit(tree, (node) => node.type === 'button' && node.props['aria-label'] === label)[0]
        || visit(tree, (node) => node.type === 'button' && text(node).includes(label))[0];
      assert.ok(button, `button "${label}" exists`);
      await button.props.onClick?.({});
    },
    async fill(label, value) {
      const input = visit(tree, (node) => ['input', 'textarea', 'select'].includes(node.type)
        && (node.props['aria-label'] === label || node.props.placeholder === label || node.props.className === label))[0];
      assert.ok(input, `input "${label}" exists`);
      await input.props.onChange?.({ target: { value, checked: value } });
    },
  };
}

function createRuntime(runtimeOptions = {}) {
  const requests = [];
  const mediaElements = [];
  const downloads = [];
  const copied = [];
  const meeting = {
    id: 'realtime-test-1', title: '10-28 可支付发票创建及逆向流程评审',
    createdAt: '2026-10-28T07:00:00Z', duration: 3600, audioId: 'audio-1',
    transcript: '大家好，今天讨论支付发票。',
    segments: [{ start: 21, end: 50, speaker: '1', text: '大家好，今天讨论支付发票。' }],
    minutes: {
      summary: '本次会议讨论可支付发票创建及逆向流程。',
      topics: [{ title: '支付流程', summary: '讨论支付流程', decisions: ['统一流程'] }],
      chapters: [{ start: 0, end: 300, title: '开票流程概述', summary: '介绍支付发票背景' }],
      viewpoints: [{ theme: '支付流程', cards: [{ stance: '支持', detail: '统一入口', risk: '进度风险' }] }],
      decisions: [{ title: '统一商户侧开户入口' }], todos: [{ text: '周五给英文版' }], disputes: [], risks: [],
    },
  };
  const savedSettings = {};
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') result = { settings: { ...(runtimeOptions.settings || {}), ...savedSettings } };
    else if (method === 'settings') {
      Object.assign(savedSettings, payload?.settings || {});
      result = { ...savedSettings };
    }
    else if (method === 'list') result = { meetings: [meeting] };
    else if (method === 'get') result = { meeting };
    else if (method === 'translate') result = { translation: 'Payment invoice discussion' };
    else if (method === 'save') result = { meeting };
    else throw new Error(`Unexpected method ${method}`);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }) };
  };
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
    const setValue = (next) => {
      const record = hooks[index];
      record.value = typeof next === 'function' ? next(record.value) : next;
    };
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
  }, mediaElements);
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  const keyListeners = [];
  const document = {
    createElement: () => ({
      click() { downloads.push({ href: this.href, download: this.download }); },
      remove() {},
    }),
    body: { appendChild() {} },
    addEventListener(type, handler) { if (type === 'keydown') keyListeners.push(handler); },
    removeEventListener(type, handler) {
      if (type !== 'keydown') return;
      const index = keyListeners.indexOf(handler);
      if (index >= 0) keyListeners.splice(index, 1);
    },
  };
  const context = {
    window, document, console, fetch, URLSearchParams,
    navigator: { clipboard: { writeText: async (value) => { copied.push(value); } } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    setTimeout: (callback) => callback(),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context);
  let mainFactory;
  const EN = {
    'settings.title': 'Service settings', 'settings.save': 'Save settings',
    'settings.section.asr': 'ASR', 'settings.section.llm': 'Minutes LLM',
    'settings.llmProvider': 'Minutes provider', 'settings.asrProvider': 'ASR provider',
    'settings.translationFallback': 'Local fallback',
    'settings.translationFallbackHint': 'Used only when MiniMax fails or is unavailable. Turn it off to disable the fallback.',
    'settings.translationFallbackProvider': 'Fallback service',
    'settings.translationFallbackModel': 'Fallback model',
    'settings.translationFallbackBaseUrl': 'Fallback endpoint',
    'settings.provider.minimaxDefault': 'MiniMax (default)',
    'settings.section.asr': 'ASR', 'settings.section.llm': 'Minutes LLM',
    'settings.section.translation': 'Realtime Translation',
    'settings.section.overlay': 'Live transcript overlay',
    'settings.section.services': 'Local services',
    'settings.overlayBackground': 'Overlay background',
    'settings.overlayText': 'Overlay text colour',
    'settings.overlayOpacity': 'Overlay opacity',
    'settings.overlayCompact': 'Show only the newest line by default',
    'settings.overlayHint': 'The overlay shows the newest line and its translation.',
    'settings.translationProvider': 'Translation provider',
    'settings.translationBaseUrl': 'Translation endpoint',
    'settings.translationModel': 'Translation model',
    'action.new': 'New meeting', 'action.refresh': 'Refresh', 'action.settings': 'Settings',
    'action.close': 'Close', 'library.importFile': 'Import audio', 'library.search': 'Search meetings',
    'library.create': 'Create minutes', 'library.templates': 'Select template to start Minutes',
    'library.empty': 'No meetings yet', 'library.hint': 'Import audio or start a new meeting.',
    'library.filter.recent': 'Recent', 'library.filter.created': 'Created',
    'library.filter.shared': 'Shared', 'library.filter.favorite': 'Favorite',
    'library.inProgress': 'Minutes in progress', 'library.backToLive': 'Back to live',
    'library.moreTemplates': 'More Templates', 'library.selected': '{count} selected',
    'assistant.open': 'AI assistant', 'assistant.close': 'Close assistant',
    'assistant.title': 'AI assistant', 'assistant.scope': 'Meetings',
    'history.chatPlaceholder': 'Ask about past meetings, todos, or next steps',
    'history.suggestLabel': 'You may want to ask', 'history.newChat': 'New chat',
    'live.pass.provisional': 'Provisional', 'live.pass.corrected': 'Corrected',
    'view.minutes': 'Minutes', 'view.live': 'Live',
    'detail.generateMinutes': 'Generate minutes', 'detail.regenerateMinutes': 'Regenerate minutes',
    'detail.back': 'Back to library', 'detail.summary': 'AI Summary',
    'detail.transcribe': 'Transcribe', 'detail.summary': 'AI Summary',
    'detail.viewpoints': 'Viewpoint Tree', 'detail.chapter': 'Chapter',
    'detail.outline': 'Outline', 'detail.play': 'Play', 'detail.pause': 'Pause',
    'detail.saveChanges': 'Save changes', 'detail.copyLink': 'Copy link',
    'detail.export': 'Export', 'detail.download': 'Download', 'detail.format': 'File Format',
    'detail.originalFile': 'Original', 'detail.audioFiles': 'Audio and video files',
    'detail.searchPlaceholder': 'Search within this meeting', 'detail.homepage': 'homepage',
    'detail.createdAt': 'Created at', 'detail.duration': 'Duration', 'detail.creator': 'Creator',
    'detail.source': 'Source', 'detail.size': 'Size', 'detail.topics': 'Topics',
    'detail.original': 'Original', 'detail.translation': 'Translation',
    'detail.hideDetails': 'Hide chapter details', 'detail.showDetails': 'Show chapter details',
    'detail.noAudio': 'No playable audio', 'detail.translationMissing': 'Choose a language to see the translation here.',
    'action.edit': 'Edit', 'action.translation': 'Translation', 'action.share': 'Share', 'action.search': 'Search',
    'meeting.title': 'Meeting title', 'meeting.titlePlaceholder': 'Enter a meeting title', 'meeting.untitled': 'Untitled meeting',
    'transcript.title': 'Transcript', 'minutes.summary': 'Summary', 'minutes.topics': 'Topics',
    'minutes.decisions': 'Decisions', 'minutes.todos': 'Todos', 'minutes.empty': 'No minutes yet.',
  };
  definition.factory(() => React).apply({
    effect: (register) => register(),
    locale: { bind: () => (key) => EN[key] || key, register: () => () => {} },
    slots: {
      inject: (name, register) => register(),
      register(options, factory) { if (options.name === 'main') mainFactory = factory; return () => {}; },
    },
  });
  return {
    renderer, requests, mediaElements, downloads, copied, mainFactory,
    pressEscape: () => { for (const handler of [...keyListeners]) handler({ key: 'Escape' }); },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

const fallbackSettings = () => ({
  translationProvider: 'minimax', translationBaseUrl: 'https://api.minimaxi.com/v1',
  translationModel: 'MiniMax-M3.1-Flash',
  translationFallbackEnabled: true, translationFallbackProvider: 'lmstudio',
  translationFallbackModel: 'hy-mt2-7b', translationFallbackBaseUrl: 'http://127.0.0.1:6121/v1',
});

test('translation settings offer MiniMax as default and a local fallback toggle', async () => {
  const runtime = createRuntime({ settings: fallbackSettings() });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Settings');
  renderer.render();
  await renderer.click('Realtime Translation');
  renderer.render();
  const text = renderer.text();
  assert.match(text, /MiniMax \(default\)/, 'the primary provider is labelled MiniMax (default)');
  assert.match(text, /Local fallback/, 'the fallback toggle is present');
  const toggles = renderer.findAll((node) => node.type === 'input' && node.props.type === 'checkbox');
  const toggle = toggles.find((node) => node.props['aria-label'] === 'Local fallback');
  assert.ok(toggle, 'the fallback checkbox exists');
  assert.equal(toggle.props.checked, true, 'the fallback is on by default');
  assert.equal(renderer.findAll((node) => node.type === 'input' && node.props.value === 'hy-mt2-7b').length, 1,
    'the fallback model is visible while enabled');

  toggle.props.onChange({ target: { checked: false } });
  renderer.render();
  assert.equal(renderer.findAll((node) => node.type === 'input' && node.props.value === 'hy-mt2-7b').length, 0,
    'fallback fields hide when the toggle is off');

  await renderer.click('Save settings');
  await runtime.flush();
  const saved = requests.filter((request) => request.method === 'settings').pop();
  assert.ok(saved, 'settings are saved');
  assert.equal(saved.payload.settings.translationFallbackEnabled, false, 'the toggle is persisted');
  assert.equal(saved.payload.settings.translationProvider, 'minimax', 'the primary translation provider is unchanged');
  assert.equal(saved.payload.settings.translationModel, 'MiniMax-M3.1-Flash', 'the primary translation model is unchanged');
});

test('enabling the fallback sends provider, model and endpoint without any API key', async () => {
  const runtime = createRuntime({ settings: { ...fallbackSettings(), translationFallbackEnabled: false } });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Settings');
  renderer.render();
  await renderer.click('Realtime Translation');
  renderer.render();
  const toggle = renderer.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')
    .find((node) => node.props['aria-label'] === 'Local fallback');
  toggle.props.onChange({ target: { checked: true } });
  renderer.render();
  assert.equal(renderer.findAll((node) => node.type === 'input' && node.props.value === 'hy-mt2-7b').length, 1,
    'the fallback model appears when enabled');
  await renderer.click('Save settings');
  await runtime.flush();
  const saved = requests.filter((request) => request.method === 'settings').pop();
  assert.equal(saved.payload.settings.translationFallbackEnabled, true);
  assert.equal(saved.payload.settings.translationFallbackProvider, 'lmstudio');
  assert.equal(saved.payload.settings.translationFallbackModel, 'hy-mt2-7b');
  assert.equal(saved.payload.settings.translationFallbackBaseUrl, 'http://127.0.0.1:6121/v1');
  assert.ok(!Object.keys(saved.payload.settings).some((key) => /fallback.*apikey/i.test(key)),
    'no fallback API key is exposed');
});

test('settings use category tabs instead of one long form', async () => {
  const runtime = createRuntime({ settings: fallbackSettings() });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Settings');
  renderer.render();
  const tabs = renderer.findAll((node) => node.props?.role === 'tab'
    && String(node.props.className || '').includes('mvm-settings-tab'));
  assert.deepEqual(tabs.map((node) => node.props.children), ['ASR', 'Minutes LLM', 'Realtime Translation', 'Live transcript overlay', 'Local services']);
  assert.equal(renderer.findAll((node) => node.props?.['aria-label'] === 'Translation provider').length, 0,
    'translation fields are hidden while ASR is selected');
  await renderer.click('Realtime Translation');
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props?.['aria-label'] === 'Translation provider').length, 1,
    'the translation tab reveals translation fields');
  await renderer.click('Minutes LLM');
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props?.['aria-label'] === 'Minutes provider').length, 1,
    'the Minutes LLM tab reveals only its own fields');
  await renderer.click('Live transcript overlay');
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props?.['aria-label'] === 'Overlay background').length, 1,
    'the overlay tab reveals the overlay appearance fields');
  assert.equal(renderer.findAll((node) => node.props?.['aria-label'] === 'Translation provider').length, 0,
    'switching tabs hides the previous category');
});
