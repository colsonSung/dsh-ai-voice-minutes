import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const TRANSLATION_BASE_URL = 'http://127.0.0.1:6121/v1';
const TRANSLATION_MODEL = 'qwen3.5-4b-mtp';

function capturePlugin() {
  let definition;
  const window = {
    __ModuleLoader__: {
      load(value) { definition = value; },
    },
  };
  vm.runInNewContext(source, { window, console });
  const registrations = [];
  let dictionaries;
  const ctx = {
    effect: (register) => register(),
    locale: {
      bind: () => (key) => key,
      register(namespace, values) {
        assert.equal(namespace, 'ai-voice-minutes');
        dictionaries = values;
        return () => {};
      },
    },
    slots: {
      inject: (name, register) => register(),
      register(options, factory) {
        registrations.push({ options, factory });
        return () => {};
      },
    },
  };
  const plugin = definition.factory(() => ({ createElement: () => null }));
  plugin.apply(ctx);
  return { definition, dictionaries, registrations };
}

test('Live locale dictionaries cover the same keys and never expose raw UI keys', () => {
  const { dictionaries } = capturePlugin();
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort());
  const required = [
    'view.minutes', 'view.live', 'live.start', 'live.stop',
    'live.sourceLanguage', 'live.targetLanguage', 'live.track',
    'live.track.all', 'live.track.mic', 'live.track.system',
    'live.original', 'live.translation', 'live.queue', 'live.latency',
    'live.degraded', 'live.error', 'settings.translationBaseUrl',
    'settings.translationModel',
  ];
  for (const language of ['zh', 'en']) {
    for (const key of required) {
      assert.equal(typeof dictionaries[language][key], 'string', `${language}.${key} is localized`);
      assert.ok(dictionaries[language][key].length > 0, `${language}.${key} is not empty`);
    }
  }
  const usedKeys = [...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(usedKeys.length > required.length, 'the check covers existing and Live UI strings');
  for (const key of new Set(usedKeys)) {
    assert.ok(dictionaries.zh[key], `zh contains ${key}`);
    assert.ok(dictionaries.en[key], `en contains ${key}`);
  }
});

test('Live API calls use the exact start, stop, and incremental status contract', () => {
  assert.match(source, /sourceLanguage:\s*liveHostSourceLanguage\(\)/);
  assert.match(source, /targetLanguage:\s*liveTargetLanguage/);
  assert.match(source, /payload\.incognito = true/);
  assert.match(source, /callHost\('live-stop',\s*\{\s*id\s*\}\)/);
  assert.match(source, /callHost\('live-status',\s*\{\s*id,\s*after:\s*liveAfterRef\.current\s*\}\)/);
  assert.match(source, /setTimeout\([^,]+,\s*1500\)/);
  assert.match(source, /clearTimeout\(timer\)/);
});

test('Live controls render bilingual events, track filters, metrics, and detailed errors', () => {
  for (const pattern of [
    /liveSourceLanguage/, /liveTargetLanguage/, /liveTrack/,
    /event\.text/, /event\.translation/, /event\.detail/,
    /liveSession\.degraded/, /metrics/, /live\.track\.all/,
    /live\.track\.mic/, /live\.track\.system/,
  ]) assert.match(source, pattern);
});

test('translation defaults are independent and the offline workflow remains intact', () => {
  assert.ok(source.includes(TRANSLATION_BASE_URL));
  assert.ok(source.includes(TRANSLATION_MODEL));
  assert.match(source, /settingField\('translationBaseUrl',\s*'settings\.translationBaseUrl'/);
  assert.match(source, /settingField\('translationModel',\s*'settings\.translationModel'/);
  for (const method of ['health', 'list', 'transcribe', 'summarize', 'save', 'get', 'delete', 'ask', 'settings']) {
    assert.match(source, new RegExp(`callHost\\('${method}'`));
  }
  for (const field of ['asrBaseUrl', 'llmBaseUrl', 'llmModel', 'apiKey']) {
    assert.match(source, new RegExp(`settingField\\('${field}'`));
  }
  assert.match(source, /\.\.\.result\.settings/);
  const onFile = source.match(/const onFile\s*=[\s\S]*?\n\s*};/);
  assert.ok(onFile, 'offline file-selection handler is preserved');
  assert.doesNotMatch(onFile[0], /uploadAudio|callHost\('transcribe'/);
});

function createReactRenderer(React, hooks, beginFrame, mediaElements = []) {
  let pendingEffects = [];
  let root = null;
  let tree = null;

  function resolve(node) {
    if (node == null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
    if (Array.isArray(node)) return node.map(resolve);
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    if (node.type === React.Fragment) return resolve(node.props.children);
    const resolved = {
      ...node,
      props: { ...node.props, children: resolve(node.props.children) },
    };
    if (node.type === 'audio' && node.props?.ref) {
      if (!node.props.ref.current) {
        const element = {
          src: node.props.src || '',
          paused: true,
          currentTime: 0,
          playCalls: 0,
          pauseCalls: 0,
          loadCalls: 0,
          listeners: {},
          addEventListener(name, listener) { this.listeners[name] = listener; },
          removeEventListener(name, listener) {
            if (this.listeners[name] === listener) delete this.listeners[name];
          },
          play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
          pause() { this.pauseCalls += 1; this.paused = true; },
          load() { this.loadCalls += 1; this.paused = true; },
          removeAttribute(name) { if (name === 'src') this.src = ''; },
        };
        node.props.ref.current = element;
        mediaElements.push(element);
      } else {
        node.props.ref.current.src = node.props.src || '';
      }
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
    unmount() {
      for (const record of hooks) {
        if (typeof record?.cleanup === 'function') record.cleanup();
      }
      root = null;
      tree = null;
    },
    text() { return text(tree); },
    findAll(predicate) { return visit(tree, predicate); },
    async click(label) {
      const button = visit(tree, (node) => node.type === 'button' && text(node).trim() === label)[0]
        || visit(tree, (node) => node.type === 'button' && node.props['aria-label'] === label)[0];
      assert.ok(button, `button "${label}" exists`);
      await button.props.onClick?.({});
    },
  };
}

function createLiveRuntime(runtimeOptions = {}) {
  const requests = [];
  const timers = new Map();
  let nextTimer = 1;
  let statusCount = 0;
  const activeSession = {
    id: 'live-1', status: 'active', startedAt: '2026-10-28T07:00:00Z',
    endedAt: null, durationSeconds: 3, degraded: true,
    metrics: { queue: 2, latencyMs: 120 },
  };
  const savedSettings = { asrBackend: 'whispercpp', hotwords: '', ...(runtimeOptions.settings || {}) };
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') {
      result = {
        settings: {
          llmBaseUrl: 'http://minimax.example/v1', llmModel: 'MiniMax-M2',
          ...savedSettings,
        },
      };
    }
    else if (method === 'list') result = { meetings: runtimeOptions.meetings || [] };
    else if (method === 'audio-list') result = { files: runtimeOptions.audioFiles || [] };
    else if (method === 'audio-delete') result = { files: runtimeOptions.audioFilesAfterDelete || [] };
    else if (method === 'live-start') result = {
      session: {
        ...activeSession,
        backend: payload.backend || '',
        hotwords: payload.hotwords || '',
      },
    };
    else if (method === 'live-summary') result = { summary: runtimeOptions.liveSummary || null };
    else if (method === 'live-summary-status') result = runtimeOptions.finalizeStatus || { pending: false, lastFinalAt: '2026-10-28T07:00:00Z', finalCount: 1 };
    else if (method === 'live-finalize') result = { session: { ...activeSession }, finalized: true };
    else if (method === 'live-active') result = { session: null, events: [] };
    else if (method === 'live-overlay-status') result = { open: false };
    else if (method === 'voices') result = { profiles: runtimeOptions.voices || [] };
    else if (method === 'voice-save') {
      if (runtimeOptions.voiceSaveError) {
        return { ok: true, status: 200, text: async () => JSON.stringify({
          ok: false, error: { message: runtimeOptions.voiceSaveError },
        }) };
      }
      result = {
        speakerLabels: { [payload.speaker]: payload.name },
        speakerProfiles: { [payload.speaker]: 'voice-auto' },
        profiles: runtimeOptions.voices || [],
      };
    }
    else if (method === 'voice-rename') result = {
      profiles: (runtimeOptions.voices || []).map((profile) => profile.id === payload.profileId
        ? { ...profile, name: payload.name } : profile),
    };
    else if (method === 'translate') result = runtimeOptions.translation || {
      translation: payload.text === 'First' ? 'First translated'
        : payload.text === 'Second' ? 'Second translated' : 'Translated summary',
    };
    else if (method === 'templates') result = { templates: [] };
    else if (method === 'settings') {
      if (!runtimeOptions.settingsResult) throw new Error('settings endpoint unavailable');
      Object.assign(savedSettings, payload?.settings || {});
      result = { ...savedSettings, ...runtimeOptions.settingsResult };
    }
    else if (method === 'live-pause') result = { session: { ...activeSession, transcriptionPaused: true } };
    else if (method === 'live-resume') result = { session: { ...activeSession, transcriptionPaused: false } };
    else if (method === 'live-overlay-open') result = { overlay: true };
    else if (method === 'live-stop') result = { session: { ...activeSession, status: 'stopped', endedAt: '2026-10-28T07:00:03Z' }, ...(runtimeOptions.stopMeeting ? { meeting: runtimeOptions.stopMeeting } : {}) };
    else if (method === 'get') result = {
      meeting: typeof runtimeOptions.getMeeting === 'function'
        ? runtimeOptions.getMeeting(payload.id) : runtimeOptions.stopMeeting,
    };
    else if (method === 'live-status') {
      statusCount += 1;
      if (typeof runtimeOptions.liveStatusEvents === 'function') {
        result = { session: { ...activeSession }, events: runtimeOptions.liveStatusEvents(statusCount) };
      } else {
      result = {
        session: { ...activeSession },
        events: [
          { seq: 1, type: 'status', detail: 'status update should not render' },
          { seq: 2, type: 'transcript', source: 'mic', text: '你好', chunkId: 42, timestamp: 834000 },
          {
            seq: 3, type: 'translation', source: 'mic', text: 'Hello', translation: 'Hello', transcript: '你好',
            chunkId: 42, timestamp: 834500, detail: statusCount === 1 ? 'translation retry succeeded' : '',
          },
        ],
      };
      }
    } else throw new Error(`Unexpected method ${method}`);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }) };
  };
  const setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { id, callback, delay, cleared: false, fired: false });
    return id;
  };
  const clearTimeout = (id) => {
    const timer = timers.get(id);
    if (timer) timer.cleared = true;
  };

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props || {}),
          ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}),
        },
      };
    },
  };

  const rendererHooks = [];
  let currentHook = 0;
  React.useState = (initial) => {
    const index = currentHook++;
    if (!rendererHooks[index]) rendererHooks[index] = { value: typeof initial === 'function' ? initial() : initial };
    const setValue = (next) => {
      const record = rendererHooks[index];
      record.value = typeof next === 'function' ? next(record.value) : next;
    };
    return [rendererHooks[index].value, setValue];
  };
  React.useRef = (initial) => {
    const index = currentHook++;
    if (!rendererHooks[index]) rendererHooks[index] = { current: initial };
    return rendererHooks[index];
  };
  React.useCallback = (callback) => {
    currentHook += 1;
    return callback;
  };
  React.useEffect = (effect, deps) => {
    const index = currentHook++;
    const previous = rendererHooks[index];
    const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
      || deps.some((value, depIndex) => !Object.is(value, previous.deps[depIndex]));
    rendererHooks[index] = { deps, effect, cleanup: previous?.cleanup };
    if (changed) React.__queueEffect(index);
  };

  const mediaElements = [];
  const renderer = createReactRenderer(React, rendererHooks, (queueEffect) => {
    currentHook = 0;
    React.__queueEffect = queueEffect;
  }, mediaElements);

  let definition;
  const documentListeners = new Map();
  const document = {
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((item) => item !== listener));
    },
  };
  const window = { __ModuleLoader__: { load(value) { definition = value; } }, confirm: () => runtimeOptions.confirmDelete !== false };
  vm.runInNewContext(source, {
    window, console, fetch, setTimeout, clearTimeout, URLSearchParams,
    setInterval: () => 0, clearInterval: () => {}, document,
  });
  let dictionaries;
  let mainFactory;
  const ctx = {
    effect: (register) => register(),
    locale: {
      bind: () => (key) => dictionaries?.en?.[key] || key,
      register(namespace, values) { dictionaries = values; return () => {}; },
    },
    slots: {
      inject: (name, register) => register(),
      register(options, factory) {
        if (options.name === 'main') mainFactory = factory;
        return () => {};
      },
    },
  };
  definition.factory((name) => {
    assert.equal(name, 'react');
    return React;
  }).apply(ctx);

  return {
    requests,
    timers,
    mediaElements,
    documentListeners,
    renderer,
    mainFactory,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    pendingTimers(delay = 1500) {
      return [...timers.values()].filter((timer) => timer.delay === delay && !timer.cleared && !timer.fired);
    },
    async fire(timer) {
      timer.fired = true;
      await timer.callback();
    },
  };
}

test('the interpretation button starts the live session in one click', async () => {
  const runtime = createLiveRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /Live transcript/, 'the quick start button is offered');

  await renderer.click('Live transcript');
  await runtime.flush();
  renderer.render();

  const started = requests.find((request) => request.method === 'live-start');
  assert.ok(started, 'the live session starts right away');
  assert.equal(started.payload.sourceLanguage, 'auto');
  assert.equal(started.payload.targetLanguage, 'en');
  assert.match(renderer.text(), /Live transcription and translation/, 'the live view is shown');
});

test('New meeting opens the Live view instead of resetting an already blank draft', async () => {
  const runtime = createLiveRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  await renderer.click('New meeting');
  renderer.render();
  assert.match(renderer.text(), /Live transcription and translation/);
  assert.match(renderer.text(), /Start live/);
});

test('the Live workspace has a back button that returns to the meeting library', async () => {
  const meeting = {
    id: 'meeting-live-back', title: 'Library destination', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', segments: [], minutes: null,
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Live');
  renderer.render();
  assert.match(renderer.text(), /Live transcription and translation/);

  await renderer.click('Back to library');
  renderer.render();
  assert.match(renderer.text(), /Library destination/, 'the meeting library is visible again');
  assert.doesNotMatch(renderer.text(), /Live transcription and translation/);
});

test('Live polling runs only while visible and active, and stop, view changes, and unmount clean it up', async () => {
  const runtime = createLiveRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  assert.equal(requests.filter((request) => request.method === 'live-status').length, 0);

  await renderer.click('Live');
  renderer.render();
  await renderer.click('Start live');
  await runtime.flush();
  renderer.render();
  await runtime.flush();
  renderer.render();

  const start = requests.find((request) => request.method === 'live-start');
  assert.deepEqual(start.payload, { sourceLanguage: 'auto', targetLanguage: 'en', backend: 'whispercpp' });
  assert.equal(requests.filter((request) => request.method === 'live-status').length, 1);
  assert.equal(runtime.pendingTimers().length, 1);
  assert.match(renderer.text(), /Hello/);
  assert.match(renderer.text(), /translation retry succeeded/);

  const firstTimer = runtime.pendingTimers()[0];
  await runtime.fire(firstTimer);
  await runtime.flush();
  const statuses = requests.filter((request) => request.method === 'live-status');
  assert.equal(statuses.length, 2);
  assert.equal(statuses[1].payload.after, 3);

  renderer.render();
  const viewTimer = runtime.pendingTimers()[0];
  await renderer.click('Minutes');
  renderer.render();
  assert.equal(viewTimer.cleared, true);
  await viewTimer.callback();
  await runtime.flush();
  assert.equal(requests.filter((request) => request.method === 'live-status').length, 2);

  await renderer.click('Live');
  renderer.render();
  await runtime.flush();
  renderer.render();
  const stopTimer = runtime.pendingTimers()[0];
  await renderer.click('End meeting');
  await runtime.flush();
  renderer.render();
  assert.deepEqual(requests.find((request) => request.method === 'live-stop').payload, { id: 'live-1' });
  assert.equal(stopTimer.cleared, true, 'the poll timer stops with the recording');
  // Ending a meeting hands the page back immediately: saving and the minutes
  // run behind it, so the reader is already in the library.
  assert.match(renderer.text(), /正在后台保存|Recording ended/);

  await renderer.click('Live');
  renderer.render();
  await renderer.click('Start live');
  await runtime.flush();
  renderer.render();
  await runtime.flush();
  const unmountTimer = runtime.pendingTimers()[0];
  assert.ok(unmountTimer, 'an active session has a poll timer before unmount');
  renderer.unmount();
  assert.equal(unmountTimer.cleared, true);
  const count = requests.filter((request) => request.method === 'live-status').length;
  await unmountTimer.callback();
  await runtime.flush();
  assert.equal(requests.filter((request) => request.method === 'live-status').length, count);
});


async function startLive(runtime) {
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  await renderer.click('Live');
  renderer.render();
  await renderer.click('Start live');
  await runtime.flush();
  renderer.render();
  await runtime.flush();
  renderer.render();
}

test('stopping a live session opens its saved meeting in the library', async () => {
  const runtime = createLiveRuntime({
    stopMeeting: {
      id: 'live-1', title: 'Recorded live meeting', createdAt: '2026-10-28T07:00:00Z',
      duration: 3, transcript: 'Saved transcript', segments: [], minutes: null,
    },
  });
  const { renderer, requests } = runtime;
  await startLive(runtime);
  await renderer.click('End meeting');
  await runtime.flush();
  renderer.render();
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /Recorded live meeting/);
  assert.match(renderer.text(), /Saved transcript/);
  assert.ok(requests.some((request) => request.method === 'get' && request.payload.id === 'live-1'));
  assert.ok(requests.some((request) => request.method === 'list'));
});

test('pause and resume change only transcription state while recording continues', async () => {
  const runtime = createLiveRuntime();
  const { renderer, requests } = runtime;
  await startLive(runtime);
  await renderer.click('Pause transcription');
  renderer.render();
  assert.match(renderer.text(), /Resume transcription/);
  assert.match(renderer.text(), /Transcription paused/);
  assert.match(renderer.text(), /End meeting/);
  await renderer.click('Resume transcription');
  renderer.render();
  assert.match(renderer.text(), /Pause transcription/);
  assert.ok(requests.some((request) => request.method === 'live-pause'));
  assert.ok(requests.some((request) => request.method === 'live-resume'));
});

test('status events stay out of the stream and chunk pairs merge with relative timestamps', async () => {
  const runtime = createLiveRuntime();
  const { renderer } = runtime;
  await startLive(runtime);
  const text = renderer.text();
  assert.doesNotMatch(text, /status update should not render/);
  assert.equal((text.match(/Hello/g) || []).length, 1, 'the translation is rendered once');
  assert.equal((text.match(/你好/g) || []).length, 1, 'original is rendered once');
  assert.match(text, /13:54/);
  assert.doesNotMatch(text, /1970/);
  const cards = renderer.findAll((node) => node.type === 'article' && String(node.props.className).includes('mvm-live-event'));
  assert.equal(cards.length, 1, 'one bilingual card per chunk');
  // The summary panel shows the generated summary, never the raw transcript lines.
  const topicCards = renderer.findAll((node) => String(node.props.className || '').includes('mvm-live-topic-card'));
  assert.equal(topicCards.length, 0, 'the raw transcript lines are not shown as the summary');
  const summaryText = renderer.findAll((node) => node.props?.['aria-label'] === 'Summary language');
  assert.equal(summaryText.length, 1, 'the summary can be switched to another language');
  assert.ok(cards.every((card) => !String(card.props.className).includes('is-error')));
});

test('Live studio has two columns, summary and notes tabs, and bottom playback controls', () => {
  for (const pattern of [
    /mvm-studio-grid/, /mvm-transcript-column/, /mvm-summary-column/,
    /mvm-playback-bar/, /Transcription/, /Real-time Summary/, /Notes/,
  ]) assert.match(source, pattern);
});

test('the player never mounts a source-less audio element and never shows an infinite length', async () => {
  const meeting = {
    id: 'realtime-player-1', title: 'Recorded meeting', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', segments: [], minutes: null,
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  const opening = opener.props.onClick({});
  // The frame before the meeting arrives must not mount a source-less player:
  // an empty src resolves to the page URL and leaves the media without a length.
  renderer.render();
  for (const audio of renderer.findAll((node) => node.type === 'audio')) {
    assert.notEqual(audio.props.src, '', 'the audio element always has a source');
  }
  await opening;
  await runtime.flush();
  renderer.render();

  const audio = renderer.findAll((node) => node.type === 'audio')[0];
  assert.ok(audio, 'the detail player exists');
  // A stream that never reports its length leaves the duration at Infinity.
  audio.props.onLoadedMetadata({ target: { duration: Infinity } });
  renderer.render();
  assert.doesNotMatch(renderer.text(), /Infinity/, 'the timeline never shows an infinite length');
  assert.doesNotMatch(renderer.text(), /NaN/, 'the timeline never shows NaN');
});

test('the transcript uses readable speaker blocks with numeric badges and secondary translations', async () => {
  const meeting = {
    id: 'meeting-readable-transcript', title: 'Readable transcript', createdAt: '2026-10-28T07:00:00Z',
    duration: 8, transcript: 'First\nSecond', minutes: null,
    segments: [
      { start: 1, end: 3, text: 'First', speaker: '1' },
      { start: 4, end: 6, text: 'Second', speaker: '2' },
    ],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();

  const blocks = renderer.findAll((node) => String(node.props.className).includes('mvm-utterance'));
  assert.ok(blocks.length >= 2, 'each speaker turn is a readable block');
  const badge = renderer.findAll((node) => String(node.props.className).includes('mvm-utterance-badge'))[0];
  assert.ok(badge, 'the speaker has a numeric badge');
  assert.match(renderer.text(), /Speaker 1/);
  assert.match(renderer.text(), /00:01/);

  await renderer.click('Translation');
  renderer.render();
  await renderer.click('English');
  await runtime.flush();
  renderer.render();
  const translations = renderer.findAll((node) => String(node.props.className).includes('mvm-utterance-translation'));
  assert.equal(translations.length, 2, 'the translation appears below each original block');
  assert.match(renderer.text(), /First translated/);
});

test('editing a speaker affects only the clicked utterance block', async () => {
  const meeting = {
    id: 'meeting-single-utterance-edit', title: 'Single utterance edit', createdAt: '2026-10-28T07:00:00Z',
    duration: 8, transcript: 'First\nSecond\nThird', minutes: null,
    segments: [
      { start: 0, end: 2, text: 'First', speaker: '1' },
      { start: 3, end: 5, text: 'Second', speaker: '2' },
      { start: 6, end: 8, text: 'Third', speaker: '1' },
    ],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  const firstSpeaker = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-utterance-speaker'))[0];
  await firstSpeaker.props.onClick({});
  renderer.render();

  const editors = renderer.findAll((node) => node.props?.className === 'mvm-speaker-editor');
  assert.equal(editors.length, 1, 'only the clicked utterance becomes an editor');
  const close = renderer.findAll((node) => node.type === 'button'
    && node.props['aria-label'] === 'Close')[0];
  assert.ok(close, 'the utterance editor has an accessible close button');
  await close.props.onClick({});
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props?.className === 'mvm-speaker-editor').length, 0,
    'closing the editor restores the read-only utterance blocks');
});

test('the viewpoint tree renders as a branched mind map with comparison cards', async () => {
  const meeting = {
    id: 'meeting-mindmap', title: 'Mind map', createdAt: '2026-10-28T07:00:00Z',
    duration: 8, transcript: 'Payment', segments: [],
    minutes: {
      viewpoints: [
        {
          theme: 'Core scenarios',
          cards: [
            { stance: 'Payment voucher', detail: 'Pay first, invoice later', risk: 'Risk A' },
            { stance: 'Payment request', detail: 'Contains a payment link' },
            { stance: 'Merchant invoice', detail: 'Input tax deduction' },
          ],
        },
        {
          theme: 'Comparison',
          cards: [
            { stance: 'Request entry', detail: 'New payment entry' },
            { stance: 'Platform invoice', detail: 'Fee charged by platform' },
          ],
        },
      ],
    },
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  await renderer.click('Viewpoint Tree');
  renderer.render();

  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-mindmap-group')).length, 2);
  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-mindmap-branch')).length, 3,
    'the three viewpoints are separate branch nodes');
  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-mindmap-comparison')).length, 1,
    'the two related viewpoints use a comparison card');
  assert.match(renderer.text(), /Core scenarios/);
  assert.match(renderer.text(), /Payment voucher/);
  assert.match(renderer.text(), /Pay first, invoice later/);
  assert.match(renderer.text(), /Risk A/);
});

test('the speaker count opens the meeting speaker list and saves a voice annotation', async () => {
  const meeting = {
    id: 'meeting-speakers-1', title: 'Speaker annotation', createdAt: '2026-10-28T07:00:00Z',
    duration: 8, transcript: 'hello\nworld', minutes: null,
    segments: [
      { start: 0, end: 3, text: 'hello', speaker: '1' },
      { start: 3, end: 6, text: 'world', speaker: '2' },
    ],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();

  const count = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-count'))[0];
  assert.ok(count, 'the speaker count is a button');
  await count.props.onClick({});
  renderer.render();
  const speaker = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-person'))[0];
  assert.ok(speaker, 'the current meeting speakers are listed');
  await speaker.props.onClick({});
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props?.className === 'mvm-speaker-editor').length, 0,
    'editing in the popover does not turn every matching transcript row into an editor');
  const input = renderer.findAll((node) => node.type === 'input'
    && String(node.props.className).includes('mvm-speaker-name-input'))[0];
  assert.ok(input, 'the selected speaker can be named');
  input.props.onChange({ target: { value: 'Alice' } });
  renderer.render();
  const save = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-save'))[0];
  await save.props.onClick({});
  await runtime.flush();
  renderer.render();

  const saved = requests.find((request) => request.method === 'voice-save');
  assert.deepEqual(saved.payload, { meetingId: 'meeting-speakers-1', speaker: '1', name: 'Alice' });
  assert.match(renderer.text(), /Alice/, 'the corrected name is shown in the transcript');
});

test('each speaker has a play button that plays only that speaker excerpt and stops at its end', async () => {
  const meeting = {
    id: 'realtime-speakers-play', title: 'Speaker playback', createdAt: '2026-10-28T07:00:00Z',
    duration: 12, transcript: 'one\ntwo', minutes: null,
    segments: [
      { start: 3, end: 6, audioStart: 3, audioEnd: 6, text: 'one', speaker: '1', source: 'mic' },
      { start: 8, end: 10, audioStart: 8, audioEnd: 10, text: 'two', speaker: '2', source: 'system' },
    ],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer, mediaElements } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  const count = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-count'))[0];
  await count.props.onClick({});
  renderer.render();

  const plays = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-play'));
  assert.equal(plays.length, 2, 'every speaker has a play button before their name');
  await plays[0].props.onClick({});
  await runtime.flush();
  const sample = mediaElements.find((item) => item.playCalls > 0);
  assert.ok(sample, 'the dedicated speaker audio element plays, not the meeting player');
  assert.match(sample.src, /live-audio\?id=realtime-speakers-play&track=mic/);
  sample.listeners.loadedmetadata?.();
  assert.equal(sample.currentTime, 3, 'playback starts at the speaker segment, not the meeting head');
  assert.equal(sample.playCalls, 1);
  assert.equal(mediaElements.filter((item) => item !== sample).every((item) => item.playCalls === 0), true,
    'the main meeting player is not started');

  sample.currentTime = 6;
  sample.ontimeupdate();
  assert.equal(sample.pauseCalls, 2, 'the excerpt pauses at the segment end');
  assert.equal(sample.loadCalls, 1);
  assert.equal(sample.src, '', 'the sample source is released after playback');
});

test('clicking outside an untouched speaker editor closes it without overlapping transcript editors', async () => {
  const meeting = {
    id: 'meeting-speakers-outside', title: 'Outside click', createdAt: '2026-10-28T07:00:00Z',
    duration: 8, transcript: 'one\ntwo\nthree', minutes: null,
    segments: [
      { start: 0, end: 2, text: 'one', speaker: '1' },
      { start: 2, end: 4, text: 'two', speaker: '2' },
      { start: 4, end: 6, text: 'three', speaker: '1' },
    ],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer, documentListeners } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  const count = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-count'))[0];
  await count.props.onClick({});
  renderer.render();
  const speaker = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-person'))[0];
  await speaker.props.onClick({});
  renderer.render();
  assert.ok(renderer.findAll((node) => node.type === 'input'
    && String(node.props.className).includes('mvm-speaker-name-input'))[0], 'the untouched editor opens');

  for (const listener of documentListeners.get('mousedown') || []) listener({ target: {} });
  renderer.render();

  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-speaker-popover')).length, 0,
    'the speaker popover closes');
  assert.equal(renderer.findAll((node) => node.props?.className === 'mvm-speaker-editor').length, 0,
    'no transcript row becomes an inline editor after the outside click');
  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-speaker-name-input')).length, 0,
    'the untouched speaker-name editor is fully dismissed');
});

test('a rejected voice annotation keeps the editor and draft visible', async () => {
  const meeting = {
    id: 'meeting-speakers-error', title: 'Missing voiceprint', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', minutes: null,
    segments: [{ start: 0, end: 2, text: 'hello', speaker: '1' }],
    speakerLabels: {}, speakerProfiles: {},
  };
  const runtime = createLiveRuntime({
    meetings: [meeting], stopMeeting: meeting, voiceSaveError: 'No voiceprint is available',
  });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  const count = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-count'))[0];
  await count.props.onClick({});
  renderer.render();
  const speaker = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-person'))[0];
  await speaker.props.onClick({});
  renderer.render();
  const input = renderer.findAll((node) => node.type === 'input'
    && String(node.props.className).includes('mvm-speaker-name-input'))[0];
  input.props.onChange({ target: { value: 'Alice' } });
  renderer.render();
  const save = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-speaker-save'))[0];
  await save.props.onClick({});
  await runtime.flush();
  renderer.render();

  const draft = renderer.findAll((node) => node.type === 'input'
    && String(node.props.className).includes('mvm-speaker-name-input'))[0];
  assert.ok(draft, 'the editor stays open after the Host rejects the annotation');
  assert.equal(draft.props.value, 'Alice');
  assert.match(renderer.text(), /No voiceprint is available/);
});

test('renaming a voice refreshes the open meeting speaker labels', async () => {
  let renamed = false;
  const meeting = {
    id: 'meeting-voice-rename-1', title: 'Voice rename', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', minutes: null,
    segments: [{ start: 0, end: 2, text: 'hello', speaker: '1' }],
    speakerLabels: { '1': 'Old name' }, speakerProfiles: { '1': 'voice-1' },
  };
  const runtime = createLiveRuntime({
    meetings: [meeting], stopMeeting: meeting,
    voices: [{ id: 'voice-1', name: 'Old name', embedding: [1] }],
    getMeeting: () => ({
      ...meeting,
      speakerLabels: { '1': renamed ? 'New name' : 'Old name' },
    }),
  });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();
  await renderer.click('Back to library');
  renderer.render();
  const trigger = renderer.findAll((node) => node.type === 'button'
    && node.props['aria-label'] === 'Voice book')[0];
  assert.ok(trigger, 'the header carries the Voice book button');
  await trigger.props.onClick({});
  renderer.render();
  const voice = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-voice-button'))[0];
  assert.ok(voice, 'the voice book panel lists the named voice');
  await voice.props.onClick({});
  renderer.render();
  const input = renderer.findAll((node) => node.type === 'input' && node.props.value === 'Old name')[0];
  input.props.onChange({ target: { value: 'New name' } });
  renderer.render();
  const form = renderer.findAll((node) => node.type === 'form'
    && String(node.props.className).includes('mvm-voice-rename'))[0];
  renamed = true;
  await form.props.onSubmit({ preventDefault() {} });
  await runtime.flush();
  renderer.render();
  const reopen = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  await reopen.props.onClick({});
  await runtime.flush();
  renderer.render();

  assert.ok(requests.some((request) => request.method === 'voice-rename'));
  assert.equal(requests.filter((request) => request.method === 'get').length, 3,
    'the open meeting is reloaded after the global rename and again when reopened');
  assert.match(renderer.text(), /New name/);
});

test('the compact voice book searches and filters named and unnamed voices', async () => {
  const runtime = createLiveRuntime({
    voices: [
      { id: 'voice-alice', name: 'Alice', embedding: [1] },
      { id: 'voice-bob', name: 'Bob', embedding: [0, 1] },
      { id: 'voice-new', name: '', embedding: [0.5, 0.5] },
    ],
  });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const trigger = renderer.findAll((node) => node.type === 'button'
    && node.props['aria-label'] === 'Voice book')[0];
  assert.ok(trigger, 'the header carries the Voice book button');
  assert.equal(trigger.props['aria-expanded'], false, 'the panel starts closed');
  await trigger.props.onClick({});
  renderer.render();
  const search = renderer.findAll((node) => node.type === 'input'
    && String(node.props.className).includes('mvm-voicebook-search-input'))[0];
  assert.ok(search, 'search is available inside the voice book');
  search.props.onChange({ target: { value: 'Alice' } });
  renderer.render();
  assert.match(renderer.text(), /Alice/);
  assert.doesNotMatch(renderer.text(), /Bob/);
  assert.doesNotMatch(renderer.text(), /Unnamed voice/);

  search.props.onChange({ target: { value: '' } });
  renderer.render();
  const filter = (label) => renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-voicebook-filter')
    && node.props.children === label)[0];
  await filter('Unnamed').props.onClick({});
  renderer.render();
  assert.match(renderer.text(), /Unnamed voice/);
  assert.doesNotMatch(renderer.text(), /Alice/);
  assert.doesNotMatch(renderer.text(), /Bob/);
  await filter('Named').props.onClick({});
  renderer.render();
  assert.match(renderer.text(), /Alice/);
  assert.match(renderer.text(), /Bob/);
  assert.doesNotMatch(renderer.text(), /Unnamed voice/);
});

test('the voice book popover has one title row, one empty state and one storage note', async () => {
  const runtime = createLiveRuntime({ voices: [] });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const trigger = renderer.findAll((node) => node.type === 'button'
    && node.props['aria-label'] === 'Voice book')[0];
  await trigger.props.onClick({});
  renderer.render();

  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-voicebook-panel-head')).length, 1,
    'the panel has one title row');
  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-voicebook-empty-state')).length, 1,
    'the empty voice book explains itself once');
  assert.equal(renderer.findAll((node) => String(node.props.className).includes('mvm-voicebook-note')).length, 1,
    'the storage note appears once');
  const panelText = renderer.text();
  assert.match(panelText, /No voice labels yet/);
  assert.equal((panelText.match(/Voiceprints are kept permanently/g) || []).length, 1,
    'the storage note is not repeated');
  assert.doesNotMatch(panelText, /Voiceprints are permanently stored and backed up\./,
    'the duplicated hint is gone');
});

test('a voice without a sample says so where the reader clicked', async () => {
  const runtime = createLiveRuntime({
    voices: [{ id: 'voice-1', name: '', embedding: [0.1] }],
  });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const trigger = renderer.findAll((node) => node.type === 'button'
    && node.props['aria-label'] === 'Voice book')[0];
  assert.ok(trigger, 'the header carries the Voice book button');
  await trigger.props.onClick({});
  renderer.render();
  // The unnamed group is the only disclosure left inside the panel.
  const group = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-voice-group-head')
    && node.props['aria-expanded'] === false)[0];
  assert.ok(group, 'the unnamed voice group can be opened');
  await group.props.onClick({});
  renderer.render();
  const play = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className).includes('mvm-voice-play'))[0];
  assert.ok(play, 'the voice has a play button');
  await play.props.onClick({});
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /No playable sample/, 'the reason is shown in the voice book');
});

test('the detail view lists the meeting audio files and can delete one', async () => {
  const meeting = {
    id: 'realtime-player-1', title: 'Recorded meeting', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', segments: [], minutes: null,
  };
  const runtime = createLiveRuntime({
    meetings: [meeting],
    stopMeeting: meeting,
    audioFiles: [
      {
        id: 'realtime-player-1:mic', kind: 'track', track: 'mic', name: 'mic.pcm', size: 2048,
        url: '/api/ai-minutes/live-audio?id=realtime-player-1&track=mic',
        downloadUrl: '/api/ai-minutes/live-audio?id=realtime-player-1&track=mic&download=1',
      },
      {
        id: 'realtime-player-1:system', kind: 'track', track: 'system', name: 'system.pcm', size: 1024,
        url: '/api/ai-minutes/live-audio?id=realtime-player-1&track=system',
        downloadUrl: '/api/ai-minutes/live-audio?id=realtime-player-1&track=system&download=1',
      },
    ],
    audioFilesAfterDelete: [],
  });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  assert.ok(opener, 'the saved meeting can be opened');
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();

  const options = renderer.findAll((node) => node.type === 'option');
  const labels = options.map((node) => String(node.props.children));
  assert.ok(labels.includes('Microphone track'), 'the microphone track is listed');
  assert.ok(labels.includes('System audio track'), 'the system track is listed');
  const download = renderer.findAll((node) => node.type === 'a' && String(node.props.href).includes('download=1'));
  assert.equal(download.length, 1, 'the selected file can be downloaded');

  const remove = renderer.findAll((node) => node.type === 'button' && node.props.title === 'Delete')[0];
  assert.ok(remove, 'the file can be deleted');
  await remove.props.onClick({});
  await runtime.flush();
  renderer.render();

  const deleted = requests.find((request) => request.method === 'audio-delete');
  assert.ok(deleted, 'a delete request was sent');
  assert.equal(deleted.payload.kind, 'track');
  assert.equal(deleted.payload.track, 'mic');
  assert.doesNotMatch(renderer.text(), /Microphone track/, 'the deleted file is gone from the list');
});

test('the live view keeps one settings entry and gives the transcript window its own icon', async () => {
  const runtime = createLiveRuntime({});
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const tabs = renderer.findAll((node) => node.type === 'button' && node.props.role === 'tab');
  assert.ok(tabs.length >= 2, 'the live tab exists');
  await tabs[1].props.onClick({});
  await runtime.flush();
  renderer.render();

  // The header carries the only settings entry; the transcript window button
  // must not borrow the same glyph.
  const nodeText = (node) => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join('');
    return nodeText(node.props?.children);
  };
  assert.equal(renderer.findAll((node) => node.props && node.props['aria-label'] === 'Settings').length, 1,
    'the settings gear appears once');
  assert.equal(renderer.findAll((node) => node.type === 'button' && nodeText(node).trim() === 'Settings').length, 0,
    'no second settings button');
  assert.equal(renderer.findAll((node) => node.props && node.props.title === 'Show transcript window').length, 1,
    'the transcript window button is there');
  assert.match(source, /icon: 'window', onClick: onLiveOverlayOpen/);
  assert.doesNotMatch(source, /icon: 'settings', onClick: onLiveOverlayOpen/);
});

test('clicking a meeting that is still recording opens the live view with its controls', async () => {
  const meeting = {
    id: 'realtime-recording-1', title: 'Still recording', createdAt: '2026-10-28T07:00:00Z',
    duration: 0, transcript: 'hello', segments: [], minutes: null, inProgress: true,
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  assert.ok(opener, 'the meeting can be opened');
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();

  // A recording belongs to the live view: the detail page carries none of the
  // live controls, so opening it there would strand the reader.
  const status = requests.find((request) => request.method === 'live-status'
    && request.payload.id === 'realtime-recording-1');
  assert.ok(status, 'the live status of that meeting is loaded');
  assert.doesNotMatch(renderer.text(), /Recording/, 'the detail page is not shown');

  await renderer.click('End meeting');
  await runtime.flush();
  renderer.render();
  const stopped = requests.find((request) => request.method === 'live-stop');
  assert.ok(stopped, 'the recording is stopped');
  assert.equal(stopped.payload.id, 'live-1', 'the live session that is running is the one that stops');
});

test('the live summary panel shows the generated summary and can switch its language', async () => {
  const runtime = createLiveRuntime({
    liveSummary: { summary: '这是一份真正的总结内容。', highlights: [{ title: '要点', detail: '细节' }] },
  });
  const { renderer, requests } = runtime;
  await startLive(runtime);
  await runtime.flush();
  renderer.render();
  assert.match(renderer.text(), /这是一份真正的总结内容/, 'the panel shows the generated summary');
  assert.doesNotMatch(renderer.text(), /Hello\b/, 'the raw transcript lines are not shown as the summary');

  const select = renderer.findAll((node) => node.type === 'select'
    && node.props['aria-label'] === 'Summary language')[0];
  assert.ok(select, 'the summary language can be chosen');
  await select.props.onChange({ target: { value: 'en' } });
  await runtime.flush();
  renderer.render();
  const request = requests.find((item) => item.method === 'live-summary' && item.payload.language === 'en');
  assert.ok(request, 'the summary is generated again in the chosen language');
  assert.equal(request.payload.force, true, 'switching the language regenerates the summary');
});

test('the detail player keeps the source that React owns after the stop effect runs', async () => {
  const meeting = {
    id: 'realtime-player-1', title: 'Recorded meeting', createdAt: '2026-10-28T07:00:00Z',
    duration: 3, transcript: 'hello', segments: [], minutes: null,
  };
  const runtime = createLiveRuntime({ meetings: [meeting], stopMeeting: meeting });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();

  const opener = renderer.findAll((node) => node.type === 'button'
    && (String(node.props.className).includes('mvm-library-open')
      || String(node.props.className).includes('mvm-meeting-card-title')))[0];
  assert.ok(opener, 'the saved meeting can be opened');
  await opener.props.onClick({});
  await runtime.flush();
  renderer.render();

  const audio = renderer.findAll((node) => node.type === 'audio')[0];
  assert.ok(audio, 'the detail player renders an audio element');
  const element = audio.props.ref.current;
  assert.ok(element, 'the audio element is mounted');
  // React owns the src: the stop effect must not take it away, or play() hangs
  // forever because the element has no media left to play.
  assert.match(String(element.src), /live-audio\?id=realtime-player-1/, 'the player keeps its source');
  assert.notEqual(element.src, '', 'the player is not left without a source');
});

test('playback toggles play and pause and cleans up on stop, view change, and unmount', async () => {
  const runtime = createLiveRuntime();
  const { renderer, mediaElements } = runtime;
  await startLive(runtime);
  const audio = mediaElements[0];
  assert.ok(audio, 'the live audio element exists');

  await renderer.click('Play recording');
  assert.equal(audio.playCalls, 1);
  const pauseBefore = audio.pauseCalls;
  renderer.render();
  await renderer.click('Pause recording');
  assert.equal(audio.pauseCalls, pauseBefore + 1);

  renderer.render();
  await renderer.click('Play recording');
  await renderer.click('End meeting');
  await runtime.flush();
  renderer.render();
  assert.ok(audio.pauseCalls >= 2, 'stop pauses playback');
  assert.ok(audio.loadCalls >= 1, 'stop releases the current audio request');
  assert.equal(audio.currentTime, 0);

  // The stop moved the page to the library and ended the session, so the
  // view-change and unmount checks start from a fresh recording.
  await startLive(runtime);
  await renderer.click('Play recording');
  await renderer.click('Minutes');
  assert.ok(audio.pauseCalls >= 3, 'view change pauses playback');
  assert.ok(audio.loadCalls >= 2, 'view change releases the audio request');

  await renderer.click('Live');
  await renderer.click('Play recording');
  renderer.unmount();
  assert.ok(audio.pauseCalls >= 4, 'unmount pauses playback');
  assert.ok(audio.loadCalls >= 3, 'unmount releases the audio request');
});

test('settings save failure is reported to the user instead of failing silently', async () => {
  const runtime = createLiveRuntime();
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  await renderer.click('Settings');
  renderer.render();
  await renderer.click('Save settings');
  renderer.render();
  assert.match(renderer.text(), /Failed to save settings/);
  assert.doesNotMatch(renderer.text(), /circular/i);
  const saved = requests.find((request) => request.method === 'settings');
  assert.ok(saved, 'a settings request was sent');
  assert.equal(typeof saved.payload.settings, 'object');
});

test('pass 1 captions are marked provisional and pass 2 replaces them with corrected text', async () => {
  let phase = 'provisional';
  const eventsFor = (pass) => [
    { seq: 1, type: 'status', detail: 'recording' },
    {
      seq: 2, type: 'transcript', source: 'mic', chunkId: 42, timestamp: 834000, pass,
      text: pass === 'final' ? '这是精修后的最终文本' : '这是临时字幕',
    },
    {
      seq: 3, type: 'translation', source: 'mic', chunkId: 42, timestamp: 834500, pass,
      text: 'text', translation: pass === 'final' ? 'This is the final refined text' : 'This is provisional',
      transcript: pass === 'final' ? '这是精修后的最终文本' : '这是临时字幕',
    },
  ];
  const runtime = createLiveRuntime({ liveStatusEvents: () => eventsFor(phase) });
  const { renderer } = runtime;
  await startLive(runtime);
  renderer.render();
  const provisionalText = renderer.text();
  assert.match(provisionalText, /Provisional/, 'pass 1 rows carry a provisional badge');
  assert.match(provisionalText, /这是临时字幕/);
  const provisionalCards = renderer.findAll((node) => node.type === 'article' && String(node.props.className).includes('is-provisional'));
  assert.equal(provisionalCards.length, 1, 'the provisional row uses the provisional style');

  phase = 'final';
  const timer = runtime.pendingTimers().find((item) => item && item.id !== undefined) || runtime.pendingTimers()[0];
  await runtime.fire(timer);
  await runtime.flush();
  renderer.render();
  const finalText = renderer.text();
  assert.match(finalText, /这是精修后的最终文本/, 'the final text replaces the provisional one');
  assert.doesNotMatch(finalText, /这是临时字幕/, 'the provisional text is gone');
  assert.match(finalText, /Corrected/, 'the refined row shows a corrected badge');
  const cards = renderer.findAll((node) => node.type === 'article' && String(node.props.className).includes('mvm-live-event'));
  assert.equal(cards.length, 1, 'pass 2 does not duplicate the row');
});

test('the refine button calls live-finalize and shows the last refined time', async () => {
  const runtime = createLiveRuntime({ finalizeStatus: { pending: false, lastFinalAt: '2026-10-28T07:00:00Z', finalCount: 2 } });
  const { renderer, requests } = runtime;
  await startLive(runtime);
  renderer.render();
  await renderer.click('Refine');
  await runtime.flush();
  renderer.render();
  const finalize = requests.find((request) => request.method === 'live-finalize');
  assert.ok(finalize, 'the refine button calls live-finalize');
  assert.deepEqual(finalize.payload, { id: 'live-1', force: true });
  assert.match(renderer.text(), /Last refined/, 'the last refined time is shown');
});

test('the ASR backend is configurable and the hotwords field is gone from settings', async () => {
  const runtime = createLiveRuntime({
    settings: { hotwords: '进件\n对账\nKYC' },
    settingsResult: { asrBackend: 'sensevoice' },
  });
  const { renderer, requests } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  await renderer.click('Settings');
  renderer.render();
  const selects = renderer.findAll((node) => node.type === 'select');
  const backend = selects.find((node) => (node.props.children || []).some((child) => child && child.props && String(child.props.value) === 'sensevoice'));
  assert.ok(backend, 'the ASR backend select exists with a SenseVoice option');
  assert.equal(renderer.findAll((node) => node.type === 'textarea').length, 0,
    'there is no hotwords textarea in the ASR settings');
  backend.props.onChange({ target: { value: 'funasr' } });
  renderer.render();
  await renderer.click('Save settings');
  await runtime.flush();
  const saved = requests.find((request) => request.method === 'settings');
  assert.ok(saved, 'settings are saved');
  assert.equal(saved.payload.settings.asrBackend, 'funasr');
  assert.equal(saved.payload.settings.hotwords, '进件\n对账\nKYC');

  await renderer.click('Settings');
  renderer.render();
  await renderer.click('Live');
  renderer.render();
  await renderer.click('Start live');
  await runtime.flush();
  const start = requests.find((request) => request.method === 'live-start');
  assert.equal(start.payload.backend, 'funasr');
  assert.equal(start.payload.hotwords, '进件,对账,KYC');
});

test('the Live header keeps language and settings controls beside the title', () => {
  assert.match(source, /className: 'mvm-live-header'/);
  assert.match(source, /className: 'mvm-live-language'/);
  assert.match(source, /className: 'mvm-live-track-filter'/);
  assert.match(source, /\.mvm-live-header\{display:flex;align-items:center/);
  assert.match(source, /\.mvm-live-language\{display:inline-flex;align-items:center/);
  assert.doesNotMatch(source, /mvm-live-topbar .+padding:12px 14px/);
});
