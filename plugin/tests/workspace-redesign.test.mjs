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
    textOf: text,
    findAll(predicate) { return visit(tree, predicate); },
    findAllWithin(rootNode, predicate) { return visit(rootNode, predicate); },
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

function createRuntime(meetingPatch = {}, { emptyLibrary = false } = {}) {
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
    ...meetingPatch,
  };
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') result = { settings: {} };
    else if (method === 'list') result = { meetings: emptyLibrary ? [] : [meeting] };
    else if (method === 'get') result = { meeting };
    else if (method === 'translate') result = { translation: 'Payment invoice discussion' };
    else if (method === 'save') result = { meeting };
    else if (method === 'live-active') result = { active: false, session: null };
    else if (method === 'live-summary-status') result = { pending: false, lastFinalAt: '', finalCount: 0 };
    else if (method === 'live-overlay-status') result = { open: false };
    else if (method === 'asr-status') result = { online: false, catalog: { entries: [], activeId: '' } };
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
    'action.new': 'New meeting', 'action.refresh': 'Refresh', 'action.settings': 'Settings',
    'action.interpret': 'Live transcript', 'home.greeting': 'Meeting workspace',
    'home.subtitle': 'Start a meeting, import a recording, or continue with existing minutes.',
    'action.favorite': 'Favorite', 'home.stat.pending': 'Pending minutes',
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

test('homepage presents a compact card grid with one primary action and no templates', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const cards = renderer.findAll((node) => node.type === 'article' && String(node.props.className || '').includes('mvm-meeting-card'));
  assert.equal(cards.length, 1, 'meetings render as cards by default');
  const tables = renderer.findAll((node) => String(node.props.className || '').includes('mvm-library-table'));
  assert.equal(tables.length, 0, 'the wide table is not the default');
  const text = renderer.text();
  assert.doesNotMatch(text, /Create minutes/, 'no duplicate create action');
  assert.doesNotMatch(text, /Select template to start Minutes/, 'templates are not a homepage section');
  const primary = renderer.findAll((node) => node.type === 'button' && String(node.props.className || '').includes('mvm-button-primary'));
  assert.equal(primary.length, 1, 'exactly one primary action on the homepage');
});

test('homepage removes the redundant meeting workspace hero', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-home-hero')).length, 0);
  assert.doesNotMatch(renderer.text(), /Meeting workspace/);
  assert.doesNotMatch(renderer.text(), /Start a meeting, import a recording, or continue with existing minutes\./);
});

test('empty library keeps each meeting action exactly once in the page header', async () => {
  const runtime = createRuntime({}, { emptyLibrary: true });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const header = renderer.findAll((node) => String(node.props.className || '').includes('mvm-header-actions'))[0];
  assert.ok(header, 'the page header exists');
  for (const label of ['Live transcript', 'New meeting']) {
    const all = renderer.findAll((node) => node.type === 'button' && renderer.textOf(node).trim() === label);
    const inHeader = renderer.findAllWithin(header, (node) => node.type === 'button' && renderer.textOf(node).trim() === label);
    assert.equal(all.length, 1, `${label} renders exactly once`);
    assert.equal(inHeader.length, 1, `${label} renders in the page header`);
  }
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-home-empty-actions')).length, 0,
    'the empty state does not repeat the header actions');
});

test('header utility actions are compact icon-only buttons with accessible names', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const header = renderer.findAll((node) => String(node.props.className || '').includes('mvm-header-actions'))[0];
  assert.ok(header, 'the page header exists');
  for (const label of ['Import audio', 'Refresh', 'AI assistant', 'Settings']) {
    const buttons = renderer.findAllWithin(header, (node) => node.type === 'button' && node.props['aria-label'] === label);
    assert.equal(buttons.length, 1, `${label} has one accessible header button`);
    assert.match(String(buttons[0].props.className || ''), /mvm-icon-button/, `${label} uses the compact icon style`);
    assert.equal(buttons[0].props.title, label, `${label} keeps its hover hint`);
    assert.equal(renderer.textOf(buttons[0]).trim(), '', `${label} does not render a text caption`);
  }
});

test('the AI assistant is closed by default and opens and closes on demand', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const drawers = () => renderer.findAll((node) => String(node.props.className || '').includes('mvm-assistant-drawer'));
  assert.equal(drawers().length, 0, 'the assistant is not rendered by default');
  await renderer.click('AI assistant');
  renderer.render();
  assert.equal(drawers().length, 1, 'the drawer opens on demand');
  assert.ok(renderer.findAll((node) => node.type === 'input' && node.props.placeholder === 'Ask about past meetings, todos, or next steps').length >= 1);
  await renderer.click('Close assistant');
  renderer.render();
  assert.equal(drawers().length, 0, 'the drawer closes');
});

test('escape closes the assistant drawer', async () => {
  const runtime = createRuntime();
  const { renderer, pressEscape } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('AI assistant');
  renderer.render();
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-assistant-drawer')).length, 1);
  pressEscape();
  renderer.render();
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-assistant-drawer')).length, 0);
});

test('the detail page is a reading workspace with template selection next to generate', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('10-28 可支付发票创建及逆向流程评审');
  await runtime.flush();
  renderer.render();
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-detail-rail')).length, 0,
    'the assistant rail is not persistent in the detail page');
  await renderer.click('AI Summary');
  renderer.render();
  const templateSelect = renderer.findAll((node) => node.type === 'select' && String(node.props.className || '').includes('mvm-template-select'));
  assert.equal(templateSelect.length, 1, 'the template picker lives next to the generate action');
  assert.match(renderer.text(), /(Generate|Regenerate) minutes/);
  await renderer.click('AI assistant');
  renderer.render();
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-assistant-drawer')).length, 1,
    'the assistant drawer is available on demand in the detail page');
});

test('live keeps the recording status visible but folds diagnostics by default', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Live');
  await runtime.flush();
  renderer.render();
  const diagnostics = renderer.findAll((node) => node.type === 'details'
    && String(node.props.className || '').includes('mvm-live-diagnostics'));
  assert.equal(diagnostics.length, 1, 'secondary metrics live in a diagnostics disclosure');
  assert.notEqual(diagnostics[0].props.open, true, 'diagnostics are collapsed by default');
  const status = renderer.findAll((node) => String(node.props.className || '').includes('mvm-live-status-badge'));
  assert.equal(status.length, 1, 'the primary recording status remains visible');
});

test('meeting cards allow favoriting without switching to the table view', async () => {
  const runtime = createRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const favorite = renderer.findAll((node) => node.type === 'button' && node.props['aria-label'] === 'Favorite')[0];
  assert.ok(favorite, 'the card exposes a favorite action');
  await favorite.props.onClick({});
  await runtime.flush();
  renderer.render();
  const saved = requests.filter((request) => request.method === 'save').at(-1);
  assert.equal(saved.payload.meeting.id, 'realtime-test-1');
  assert.equal(saved.payload.meeting.favorite, true);
});

test('pending minutes statistics do not count a meeting that is still recording', async () => {
  const runtime = createRuntime({ minutes: null, liveStatus: 'recording' });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const cards = renderer.findAll((node) => String(node.props.className || '').includes('mvm-stat-card'));
  const pending = cards.find((node) => {
    const values = node.props.children;
    return Array.isArray(values) && values.some((child) => child?.props?.children === 'Pending minutes');
  });
  assert.ok(pending, 'the pending statistics card exists');
  const values = pending.props.children;
  assert.equal(values[0].props.children, '0');
});
