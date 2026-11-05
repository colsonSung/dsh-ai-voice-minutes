import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

// Pull one declaration block out of the plugin stylesheet.
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `${selector} has a rule in the plugin stylesheet`);
  return match[1];
}

// A tiny React stand-in: the plugin only needs createElement, a few hooks and
// a way to walk the tree that was rendered.
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
  };
}

const AUDIO_FILE = {
  id: 'audio-1',
  kind: 'upload',
  name: 'meeting.wav',
  size: 2048,
  mime: 'audio/wav',
  url: '/api/ai-minutes/meeting-audio?id=audio-1',
  downloadUrl: '/api/ai-minutes/meeting-audio?id=audio-1&download=1',
};

function createRuntime({ audioFiles = [], meetingPatch = {} } = {}) {
  const requests = [];
  const mediaElements = [];
  const meeting = {
    id: 'meeting-audio-1', title: 'Quarterly review', createdAt: '2026-11-05T02:00:00Z',
    duration: 467, audioId: 'audio-1', transcript: 'hello', segments: [], minutes: null,
    ...meetingPatch,
  };
  const fetch = async (route, options) => {
    assert.equal(route, '/api/ai-minutes');
    const { method, payload } = JSON.parse(options.body);
    requests.push({ method, payload });
    let result;
    if (method === 'health') result = { settings: {} };
    else if (method === 'list') result = { meetings: [meeting] };
    else if (method === 'get') result = { meeting };
    else if (method === 'audio-list') result = { files: audioFiles };
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
  let mainFactory;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  const document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    window, document, console, fetch, URLSearchParams,
    navigator: { clipboard: { writeText: async () => {} } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    setTimeout: (callback) => callback(),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context);
  const EN = {
    'app.title': 'Local AI Voice Minutes', 'nav.label': 'Minutes',
    'action.new': 'New meeting', 'action.refresh': 'Refresh', 'action.settings': 'Settings',
    'action.interpret': 'Live transcript', 'action.favorite': 'Favorite', 'action.close': 'Close',
    'action.edit': 'Edit', 'action.translation': 'Translation', 'action.share': 'Share', 'action.search': 'Search',
    'home.greeting': 'Meeting workspace', 'home.subtitle': 'Minutes in one place.',
    'library.importFile': 'Import audio', 'library.search': 'Search meetings',
    'library.empty': 'No meetings yet', 'library.hint': 'Import audio or start a new meeting.',
    'library.filter.recent': 'Recent', 'library.filter.created': 'Created',
    'library.filter.shared': 'Shared', 'library.filter.favorite': 'Favorite',
    'library.inProgress': 'Minutes in progress', 'library.backToLive': 'Back to live',
    'assistant.open': 'AI assistant', 'assistant.close': 'Close assistant',
    'assistant.title': 'AI assistant', 'assistant.scope': 'Meetings',
    'voice.title': 'Voice book', 'voice.hint': 'Name a speaker once.',
    'history.chatPlaceholder': 'Ask about past meetings', 'history.suggestLabel': 'You may want to ask',
    'history.newChat': 'New chat',
    'live.pass.provisional': 'Provisional', 'live.pass.corrected': 'Corrected',
    'view.minutes': 'Minutes', 'view.live': 'Live',
    'detail.generateMinutes': 'Generate minutes', 'detail.regenerateMinutes': 'Regenerate minutes',
    'detail.back': 'Back to library', 'detail.summary': 'AI Summary', 'detail.transcribe': 'Transcribe',
    'detail.viewpoints': 'Viewpoint Tree', 'detail.chapter': 'Chapter', 'detail.outline': 'Outline',
    'detail.play': 'Play', 'detail.pause': 'Pause', 'detail.saveChanges': 'Save changes',
    'detail.copyLink': 'Copy link', 'detail.export': 'Export', 'detail.download': 'Download',
    'detail.format': 'File Format', 'detail.originalFile': 'Original',
    'detail.audioFiles': 'Audio and video files', 'detail.searchPlaceholder': 'Search within this meeting',
    'detail.createdAt': 'Created at', 'detail.duration': 'Duration', 'detail.creator': 'Creator',
    'detail.source': 'Source', 'detail.size': 'Size', 'detail.topics': 'Topics', 'detail.original': 'Original',
    'detail.translation': 'Translation', 'detail.hideDetails': 'Hide chapter details',
    'detail.showDetails': 'Show chapter details', 'detail.noAudio': 'No playable audio',
    'detail.noRecording': 'There is no recording to play for this meeting',
    'detail.translationMissing': 'Choose a language to see the translation here.',
    'detail.skipBack': 'Back 15 seconds', 'detail.skipForward': 'Forward 15 seconds',
    'detail.playbackSpeed': 'Playback speed', 'detail.audioResources': 'Audio resources',
    'meeting.title': 'Meeting title', 'meeting.titlePlaceholder': 'Enter a meeting title',
    'meeting.untitled': 'Untitled meeting', 'transcript.title': 'Transcript',
    'minutes.summary': 'Summary', 'minutes.topics': 'Topics', 'minutes.decisions': 'Decisions',
    'minutes.todos': 'Todos', 'minutes.empty': 'No minutes yet.',
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
    renderer, requests, mediaElements, mainFactory,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

/** Open the meeting in the detail page and settle every host call it makes. */
async function openMeeting(runtime, title = 'Quarterly review') {
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click(title);
  await runtime.flush();
  renderer.render();
  return renderer;
}

test('the detail header back control is an icon-only button that keeps its name', async () => {
  const runtime = createRuntime();
  const renderer = await openMeeting(runtime);

  const header = renderer.findAll((node) => node.props.className === 'mvm-detail-header')[0];
  assert.ok(header, 'the detail header renders');
  const back = renderer.findAllWithin(header, (node) => node.type === 'button'
    && String(node.props.className || '').includes('mvm-back-button'))[0];
  assert.ok(back, 'the header carries a back button');
  assert.equal(renderer.textOf(back).trim(), '', 'the back button shows no text label');
  assert.equal(back.props['aria-label'], 'Back to library', 'the button keeps an accessible name');
  assert.equal(back.props.title, 'Back to library', 'the button keeps a hover hint');

  // It draws the same arrow glyph as the live page back button.
  const arrow = renderer.findAllWithin(back, (node) => node.type === 'svg')[0];
  assert.ok(arrow, 'the back button draws an arrow');
  const glyph = renderer.findAllWithin(back, (node) => node.props?.d)[0];
  assert.equal(glyph.props.d, 'M19 12H5m7 7-7-7 7-7', 'it reuses the arrow-left glyph');
});

test('the icon-only back control cannot be squeezed into a text wrap', () => {
  const icon = rule('.mvm-back-button-icon');
  assert.match(icon, /white-space:nowrap/, 'the button never wraps its label');
  assert.match(icon, /width:30px/, 'the button keeps a fixed compact width');
  assert.match(icon, /flex:none/, 'the button never shrinks inside the breadcrumb');
  assert.match(icon, /padding:0/, 'the icon sits centred in the button');
});

test('the detail back control still returns to the meeting library', async () => {
  const runtime = createRuntime();
  const renderer = await openMeeting(runtime);
  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-detail-header').length, 1,
    'the meeting detail page is open');
  await renderer.click('Back to library');
  renderer.render();
  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-detail-header').length, 0,
    'the back control leaves the detail page');
  assert.match(renderer.text(), /Quarterly review/, 'the meeting library is back');
});

test('the live page keeps its labelled back button', async () => {
  const runtime = createRuntime();
  const { renderer } = runtime;
  renderer.mount(runtime.mainFactory());
  await runtime.flush();
  renderer.render();
  await renderer.click('Live');
  await runtime.flush();
  renderer.render();
  const back = renderer.findAll((node) => node.type === 'button'
    && String(node.props.className || '').includes('mvm-live-back'))[0];
  assert.ok(back, 'the live page still has its back button');
  assert.equal(renderer.textOf(back).trim(), 'Back to library', 'the live back button keeps its text');
});

test('a meeting with no audio files renders no player controls and no error banner', async () => {
  const runtime = createRuntime({ audioFiles: [] });
  const renderer = await openMeeting(runtime);

  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-player-timeline').length, 0,
    'the scrubber is gone');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-player-play')).length, 0,
    'the play button is gone');
  assert.equal(renderer.findAll((node) => node.type === 'input' && node.props.type === 'range').length, 0,
    'the progress slider is gone');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-skip-button')).length, 0,
    'the skip buttons are gone');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-rate-select')).length, 0,
    'the speed selector is gone');

  const note = renderer.findAll((node) => node.props.className === 'mvm-detail-audio-empty')[0];
  assert.ok(note, 'a quiet note stands in for the player');
  assert.equal(renderer.textOf(note).trim(), 'There is no recording to play for this meeting');

  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-alert-error')).length, 0,
    'no red error banner is shown');
  assert.equal(renderer.findAll((node) => node.props.role === 'alert').length, 0, 'nothing is announced as an error');
  assert.doesNotMatch(renderer.text(), /No playable audio/, 'the old error wording is gone');
});

test('a meeting with audio still renders the player and its controls', async () => {
  const runtime = createRuntime({ audioFiles: [AUDIO_FILE] });
  const renderer = await openMeeting(runtime);

  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-player-timeline').length, 1,
    'the scrubber is back');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-player-play')).length, 1,
    'the play button is back');
  assert.equal(renderer.findAll((node) => node.type === 'input' && node.props.type === 'range').length, 1,
    'the progress slider is back');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-skip-button')).length, 2,
    'the skip buttons are back');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-rate-select')).length, 1,
    'the speed selector is back');
  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-detail-audio-empty').length, 0,
    'no empty note is shown');
  const audio = renderer.findAll((node) => node.type === 'audio')[0];
  assert.ok(audio, 'the player owns its media element');
  assert.match(String(audio.props.src), /meeting-audio\?id=audio-1/, 'it plays the file the host listed');
});

test('a recording that will not load is a soft state, not a page level failure', async () => {
  const runtime = createRuntime({ audioFiles: [AUDIO_FILE] });
  const renderer = await openMeeting(runtime);

  const audio = renderer.findAll((node) => node.type === 'audio')[0];
  assert.ok(audio, 'the player owns its media element');
  audio.props.onError();
  renderer.render();

  assert.equal(renderer.findAll((node) => node.props.className === 'mvm-player-timeline').length, 0,
    'the dead scrubber is dropped');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-rate-select')).length, 0,
    'the dead speed selector is dropped');
  assert.ok(renderer.findAll((node) => node.props.className === 'mvm-detail-audio-empty')[0],
    'the quiet note stands in for the player');
  assert.equal(renderer.findAll((node) => String(node.props.className || '').includes('mvm-alert-error')).length, 0,
    'no red error banner is shown');
  assert.equal(renderer.findAll((node) => node.props.role === 'alert').length, 0, 'nothing is announced as an error');
});

test('a missing recording is never reported through the global error state', () => {
  assert.doesNotMatch(source, /setError\(t\('detail\.noAudio'\)\)/,
    'the red banner no longer carries the missing recording');
  assert.match(source, /setNotice\(t\('detail\.noAudio'\)\)/,
    'the export path reports it as a soft notice');
  assert.match(source, /const audioMissing = audioListLoaded && !audioFiles\.length;/,
    'the player follows the audio list the host returned');
});
