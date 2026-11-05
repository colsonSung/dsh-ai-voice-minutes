import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function createRenderer(React, hooks, beginFrame) {
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
    unmount() { root = null; tree = null; },
    text() { return text(tree); },
    findAll(predicate) { return visit(tree, predicate); },
    async click(label) {
      const button = visit(tree, (node) => node.type === 'button' && text(node).trim() === label)[0]
        || visit(tree, (node) => node.type === 'button' && text(node).includes(label))[0];
      assert.ok(button, `button "${label}" exists`);
      await button.props.onClick?.({});
    },
  };
}

function createRuntime() {
  const requests = [];
  const templates = [
    { id: 'intelligent-slicing', name: '智能切片', description: '按议题切分并生成结论', vip: false, builtin: true },
    { id: 'visual-summary', name: '可视化摘要', description: '结构化要点与图表', vip: true, builtin: true },
    { id: 'classic', name: '经典纪要', description: '标准会议纪要结构', vip: false, builtin: true },
    { id: 'meeting-minutes', name: '标准会议纪要', description: '完整纪要模板', vip: false, builtin: true },
  ];
  const running = {
    id: 'realtime-live-1', title: '正在进行的会议', createdAt: '2026-10-29T08:00:00Z',
    duration: 120, creator: 'ethansong', source: 'AI Minutes', size: 4096, inProgress: true,
    liveStatus: 'recording', hasMinutes: false, excerpt: '正在转写会议内容',
  };
  const finished = {
    id: 'meeting-done-1', title: '已完成的会议', createdAt: '2026-10-28T02:00:00Z',
    duration: 3600, creator: 'ethansong', source: 'AI Minutes', size: 2048, inProgress: false,
    liveStatus: 'stopped', hasMinutes: true, excerpt: '讨论支付流程的会议纪要', favorite: true,
  };
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') result = { settings: {}, asr: { alive: true, detail: 'asr ready' }, llm: { alive: false, detail: 'llm refused' } };
    else if (method === 'list') result = { meetings: [running, finished] };
    else if (method === 'templates') result = { templates };
    else if (method === 'voices') result = { profiles: [] };
    else if (method === 'live-start') result = { session: { id: 'realtime-live-1', status: 'recording', startedAt: '2026-10-29T08:00:00Z', metrics: {} } };
    else if (method === 'live-status') result = { session: { id: 'realtime-live-1', status: 'recording', startedAt: '2026-10-29T08:00:00Z', durationSeconds: 65, metrics: {} }, events: [] };
    else if (method === 'live-stop') result = { session: { id: 'realtime-live-1', status: 'stopped' } };
    else if (method === 'live-mark') result = { ok: true };
    else if (method === 'save') result = { meeting: finished };
    else if (method === 'get') result = { meeting: finished };
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
  });
  let definition;
  const timers = new Map();
  let nextTimer = 1;
  const context = {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
    document: { addEventListener() {}, removeEventListener() {} },
    console, fetch,
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: () => 0,
    clearInterval: () => {},
    URLSearchParams, navigator: { language: 'zh-CN' },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
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
    renderer, requests, mainFactory, timers,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    pendingTimers: (delay) => [...timers.values()].filter((timer) => timer.delay === delay),
    async fireTimer(delay) {
      const timer = [...timers.values()].find((item) => item.delay === delay);
      assert.ok(timer, `timer with delay ${delay} exists`);
      timers.delete(timer.id);
      await timer.callback();
    },
  };
}

const EN = {
  'library.title': 'Meeting library', 'library.hint': 'Save a meeting after transcription to find it here.',
  'library.empty': 'No meetings yet', 'library.search': 'Search meetings', 'library.importFile': 'Import file',
  'library.inProgress': 'Minutes in progress', 'library.templates': 'Select template to start Minutes',
  'library.moreTemplates': 'More Templates >', 'library.filter.recent': 'Recent', 'library.filter.created': 'Created',
  'library.filter.shared': 'Shared', 'library.filter.favorite': 'Favorite', 'library.view.list': 'List view',
  'library.view.grid': 'Grid view', 'library.create': 'Create minutes', 'library.selected': '{count} selected',
  'library.backToLive': 'Back to live',
  'live.title': 'Live transcription', 'live.subtitle': 'Real-time transcription and translation',
  'live.sourceLanguage': 'Source', 'live.targetLanguage': 'Translate to', 'live.source.auto': 'Automatic Identification',
  'live.source.zhEn': 'Support only Chinese and English', 'live.source.zh': '中文', 'live.source.en': 'English',
  'live.incognito': 'Incognito', 'live.incognitoEnabled': 'Enabled', 'live.incognitoNotEnabled': 'Not Enabled',
  'live.controls.note': 'Note', 'live.controls.flag': 'Flag', 'live.topic': 'Meeting Topic',
  'live.minutesAuto': 'Meeting minutes will update automatically in AI Minutes...',
  'live.summarySkeleton': 'Preparing the live summary', 'live.error.retry': 'Retry', 'live.error.endpoint': 'Endpoint',
  'live.start': 'Start live', 'live.endMeeting': 'End meeting', 'live.pauseTranscription': 'Pause transcription',
  'live.resumeTranscription': 'Resume transcription', 'live.track': 'Track', 'live.track.all': 'All',
  'live.track.mic': 'Microphone', 'live.track.system': 'System audio', 'live.play': 'Play', 'live.pause': 'Pause',
  'live.desktop': 'Desktop window', 'live.summary': 'Real-time Summary', 'live.notes': 'Notes',
  'live.transcription': 'Transcription', 'live.empty': 'Nothing yet', 'live.translationPending': 'Translating...',
  'live.status': 'Status', 'live.queue': 'Queue', 'live.latency': 'Latency', 'live.duration': 'Duration',
  'live.degraded': 'Degraded', 'live.error': 'Error', 'live.starting': 'Starting', 'live.stopping': 'Stopping',
  'live.audioTrack': 'Audio track', 'live.source.mic': 'Microphone', 'live.source.system': 'System audio',
  'live.source.unknown': 'Unknown', 'live.original': 'Original', 'live.translation': 'Translation',
  'live.details': 'Details', 'action.settings': 'Settings', 'action.import': 'Import', 'action.delete': 'Delete',
  'action.favorite': 'Favorite', 'action.close': 'Close', 'action.refresh': 'Refresh', 'state.loading': 'Loading',
  'meeting.untitled': 'Untitled meeting', 'view.minutes': 'Minutes', 'view.live': 'Live',
  'status.asr': 'ASR', 'status.llm': 'LLM', 'status.online': 'Online', 'status.offline': 'Offline',
  'status.unknown': 'Checking',
};

test('live studio exposes a floating control bar with markers, timer and incognito', () => {
  assert.match(source, /mvm-live-control-bar/);
  assert.match(source, /mvm-live-recording-dots/);
  assert.match(source, /mvm-live-timer/);
  assert.match(source, /callHost\('live-mark'/);
  assert.match(source, /liveIncognito/);
  assert.match(source, /payload\.incognito = true/);
  assert.match(source, /live\.incognitoEnabled/);
  assert.match(source, /mvm-live-topic/);
  assert.match(source, /mvm-live-skeleton/);
  assert.match(source, /live\.minutesAuto/);
});

test('meeting library shows templates, filter tabs and an in-progress row', () => {
  assert.match(source, /callHost\('templates'/);
  // The template wall was removed from the library on purpose ("no template
  // wall"); the picker now lives in the detail tab header as a select.
  assert.match(source, /mvm-template-picker/);
  assert.match(source, /mvm-template-select/);
  assert.match(source, /library\.filter\.recent/);
  assert.match(source, /library\.filter\.favorite/);
  assert.match(source, /library\.view\.grid/);
  assert.match(source, /meeting\.inProgress/);
  // The in-progress marker is a small inline pill, not the old full bar.
  assert.match(source, /mvm-library-progress-pill/);
  assert.match(source, /library\.search/);
});

test('runtime: the header health badges name the service and keep the state in the tooltip', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const text = renderer.text();
  assert.match(text, /ASR/, 'the ASR badge is named');
  assert.match(text, /LLM/, 'the LLM badge is named');
  assert.doesNotMatch(text, /Online/, 'the online word is gone');
  assert.doesNotMatch(text, /Offline/, 'the offline word is gone');
  const badges = renderer.findAll((node) => String(node.props?.className || '').includes('mvm-health-item'));
  assert.equal(badges.length, 2, 'both service badges are rendered');
  const titles = badges.map((node) => node.props.title);
  assert.ok(titles.some((title) => /ASR · Online/.test(title)), 'the state stays in the tooltip');
  assert.ok(titles.some((title) => /LLM · Offline/.test(title)), 'the offline state stays in the tooltip');
});

test('summaries are generated with the selected template', () => {
  assert.match(source, /template:\s*selectedTemplate/);
});

test('runtime: library shows filter tabs, the running meeting badge and no template wall', async () => {
  const runtime = createRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /Minutes in progress/);
  assert.match(renderer.text(), /Recent/);
  assert.match(renderer.text(), /Favorite/);
  assert.doesNotMatch(renderer.text(), /Select template to start Minutes/);
  assert.ok(requests.some((request) => request.method === 'templates'), 'templates are still loaded for the detail picker');
});

test('runtime: filter tabs switch the visible rows', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /已完成的会议/);
  await renderer.click('Favorite');
  renderer.render();
  assert.match(renderer.text(), /已完成的会议/);
  await renderer.click('Recent');
  renderer.render();
  assert.match(renderer.text(), /正在进行的会议/);
});

test('runtime: incognito toggle and live markers are sent to the Host', async () => {
  const runtime = createRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Live');
  renderer.render();
  await renderer.click('Incognito');
  renderer.render();
  assert.match(renderer.text(), /Incognito/);
  await renderer.click('Start live');
  await runtime.flush();
  const start = requests.find((request) => request.method === 'live-start');
  assert.equal(start.payload.incognito, true);
  assert.equal(start.payload.targetLanguage, 'en');
});

test('runtime: a running meeting refreshes the library and can return to the live view', async () => {
  const runtime = createRuntime();
  const { renderer, requests, pendingTimers, fireTimer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.ok(pendingTimers(5000).length >= 1, 'the library refreshes while a session is running');
  const listCallsBefore = requests.filter((request) => request.method === 'list').length;
  await fireTimer(5000);
  await runtime.flush();
  assert.ok(requests.filter((request) => request.method === 'list').length > listCallsBefore, 'the list is refreshed');

  await renderer.click('Back to live');
  await runtime.flush();
  renderer.render();
  assert.ok(requests.some((request) => request.method === 'live-status' && request.payload.id === 'realtime-live-1'),
    'the live session is restored');
  assert.match(renderer.text(), /Source/);
});
