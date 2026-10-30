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

function createRuntime() {
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
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') result = { settings: {} };
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
  const document = {
    createElement: () => ({
      click() { downloads.push({ href: this.href, download: this.download }); },
      remove() {},
    }),
    body: { appendChild() {} },
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
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('library opens detail tabs, chapter outline, and real audio controls', async () => {
  const runtime = createRuntime();
  const { renderer, mediaElements, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /10-28 可支付发票创建及逆向流程评审/);
  assert.equal(renderer.findAll((node) => node.type === 'article' && /\bmvm-meeting-card\b/.test(String(node.props.className || ''))).length, 1);
  await renderer.click('10-28 可支付发票创建及逆向流程评审');
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /Transcribe/);
  assert.match(renderer.text(), /AI Summary/);
  assert.match(renderer.text(), /Viewpoint Tree/);
  assert.match(renderer.text(), /Chapter/);
  const audio = mediaElements[0];
  await renderer.click('Play');
  assert.equal(audio.playCalls, 1);
  const speed = renderer.findAll((node) => node.type === 'select'
    && String(node.props.className).includes('mvm-rate-select'))[0];
  assert.ok(speed, 'the playback speed menu exists');
  speed.props.onChange({ target: { value: '1.25' } });
  assert.equal(audio.playbackRate, 1.25);
  await renderer.click('AI Summary');
  renderer.render();
  assert.match(renderer.text(), /Outline/);
  await renderer.click('开票流程概述');
  renderer.render();
  assert.match(renderer.text(), /介绍支付发票背景/);
});

test('translation, search, editing, sharing, and JSON export execute end to end', async () => {
  const runtime = createRuntime();
  const { renderer, requests, copied, downloads } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('10-28 可支付发票创建及逆向流程评审');
  await runtime.flush();
  renderer.render();
  await renderer.click('Translation');
  renderer.render();
  await renderer.click('English');
  await runtime.flush();
  renderer.render();
  assert.ok(requests.some((request) => request.method === 'translate' && request.payload.options.targetLanguage === 'en'));
  assert.match(renderer.text(), /Payment invoice discussion/);
  await renderer.click('Search');
  renderer.render();
  await renderer.fill('Search within this meeting', '支付');
  renderer.render();
  assert.match(renderer.text(), /今天讨论支付发票/);
  await renderer.click('Edit');
  renderer.render();
  await renderer.fill('Meeting title', 'Updated meeting title');
  renderer.render();
  await renderer.click('Save changes');
  await runtime.flush();
  assert.ok(requests.some((request) => request.method === 'save' && request.payload.meeting.title === 'Updated meeting title'));
  await renderer.click('Share');
  renderer.render();
  await renderer.click('Copy link');
  await runtime.flush();
  assert.ok(copied.some((value) => value.includes('realtime-test-1')));
  await renderer.click('Export/Download');
  renderer.render();
  await renderer.fill('File Format', 'JSON');
  renderer.render();
  await renderer.click('Export');
  renderer.render();
  assert.ok(downloads.some((download) => download.download.endsWith('.json')));
});
