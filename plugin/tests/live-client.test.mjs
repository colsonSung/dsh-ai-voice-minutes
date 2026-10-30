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
    else if (method === 'get') result = { meeting: runtimeOptions.stopMeeting };
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
  const window = { __ModuleLoader__: { load(value) { definition = value; } }, confirm: () => runtimeOptions.confirmDelete !== false };
  vm.runInNewContext(source, {
    window, console, fetch, setTimeout, clearTimeout, URLSearchParams,
    setInterval: () => 0, clearInterval: () => {},
    document: { addEventListener() {}, removeEventListener() {} },
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
  assert.equal(stopTimer.cleared, true);
  assert.equal(runtime.pendingTimers().length, 0);

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

test('a voice without a sample says so where the reader clicked', async () => {
  const runtime = createLiveRuntime({
    voices: [{ id: 'voice-1', name: '', embedding: [0.1] }],
  });
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('AI assistant');
  renderer.render();
  // The voice book and the unnamed group are two separate disclosures.
  for (let step = 0; step < 2; step += 1) {
    const group = renderer.findAll((node) => node.type === 'button'
      && String(node.props.className).includes('mvm-voice-group-head')
      && node.props['aria-expanded'] === false)[0];
    assert.ok(group, 'the voice book group can be opened');
    await group.props.onClick({});
    renderer.render();
  }
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
