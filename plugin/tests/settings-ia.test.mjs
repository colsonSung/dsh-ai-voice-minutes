import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntime, EN } from './helpers/settings-runtime.mjs';

/** Render the plugin page and open the settings dialog on the first tab. */
async function openSettings(options = {}) {
  const runtime = createRuntime(options);
  runtime.renderer.mount(runtime.mainFactory());
  await runtime.flush();
  runtime.renderer.render();
  await runtime.renderer.click(EN['action.settings']);
  runtime.renderer.render();
  return runtime;
}

const tabsOf = (runtime) => runtime.renderer.findAll((node) => node.props?.role === 'tab'
  && String(node.props.className || '').includes('mvm-settings-tab'));

const labelsOf = (runtime) => runtime.renderer.findAll((node) => typeof node.props?.['aria-label'] === 'string')
  .map((node) => node.props['aria-label']);

const selectByLabel = (runtime, label) => runtime.renderer.findAll((node) => node.type === 'select'
  && node.props['aria-label'] === label)[0];

const optionTexts = (select) => {
  const texts = [];
  const walk = (node) => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (node.type === 'option') texts.push(String(node.props.children));
    walk(node.props?.children);
  };
  walk(select.props.children);
  return texts;
};

const contains = (node, target) => {
  if (node === target) return true;
  if (node == null || typeof node !== 'object') return false;
  const children = Array.isArray(node) ? node : node.props?.children;
  if (Array.isArray(children)) return children.some((child) => contains(child, target));
  return contains(children, target);
};

test('settings is five named jobs, and the panel is bound to its tab', async () => {
  const runtime = await openSettings();
  const tabs = tabsOf(runtime);
  assert.deepEqual(tabs.map((node) => String(node.props.children)), [
    EN['settings.section.asr'],
    EN['settings.section.llm'],
    EN['settings.section.translation'],
    EN['settings.section.overlay'],
    EN['settings.section.services'],
  ]);
  assert.equal(tabs[0].props['aria-selected'], true);
  assert.equal(tabs[0].props.id, 'mvm-settings-tab-asr');
  assert.equal(tabs[0].props['aria-controls'], 'mvm-settings-panel-asr');

  const panels = runtime.renderer.findAll((node) => node.props?.role === 'tabpanel');
  assert.equal(panels.length, 1, 'only the selected tab renders a panel');
  assert.equal(panels[0].props.id, 'mvm-settings-panel-asr');
  assert.equal(panels[0].props['aria-labelledby'], 'mvm-settings-tab-asr');
});

test('the ASR tab has a single caption model control, not three overlapping ones', async () => {
  const runtime = await openSettings();
  const labels = labelsOf(runtime);
  assert.equal(labels.filter((label) => label === EN['settings.asr.liveModel']).length, 1,
    'one control answers which model writes the captions');
  assert.ok(!labels.includes(EN['settings.asrBackend']), 'there is no second backend select');
  assert.ok(!labels.includes('ASR model ID'), 'the old free-text model id does not appear for the local provider');

  const select = selectByLabel(runtime, EN['settings.asr.liveModel']);
  assert.ok(select, 'the caption model select exists');
  const texts = optionTexts(select);
  assert.ok(texts.some((text) => text.startsWith('SenseVoice · ')), 'the active model is listed');
  assert.ok(texts.some((text) => text.startsWith('Large v3 Turbo · ')), 'whisper.cpp models are listed');
  assert.ok(!texts.some((text) => text.includes('Fun-ASR-Nano')), 'the refinement model is not a caption model');
  assert.ok(!texts.some((text) => text.includes('ECAPA')), 'the diarization model is not a caption model');
});

test('the caption select switches a downloaded model and downloads a missing one', async () => {
  const runtime = await openSettings();
  await runtime.renderer.fill(EN['settings.asr.liveModel'], 'ggml-large-v3-turbo.bin');
  await runtime.flush();
  const selectCall = runtime.requests.find((request) => request.method === 'asr-select-model');
  assert.ok(selectCall, 'a downloaded model is switched');
  assert.equal(selectCall.payload.id, 'ggml-large-v3-turbo.bin');

  await runtime.renderer.fill(EN['settings.asr.liveModel'], 'ggml-tiny.bin');
  await runtime.flush();
  const downloadCall = runtime.requests.find((request) => request.method === 'asr-download-model');
  assert.ok(downloadCall, 'a missing model is downloaded');
  assert.equal(downloadCall.payload.id, 'ggml-tiny.bin');
});

test('the services tab owns the runtime work and does not repeat the active model', async () => {
  const runtime = await openSettings();
  await runtime.renderer.click(EN['settings.section.services']);
  runtime.renderer.render();
  const text = runtime.renderer.text();

  assert.match(text, new RegExp(EN['settings.asr.serviceTitle']));
  for (const label of ['settings.asr.start', 'settings.asr.stop', 'settings.asr.restart', 'action.refresh']) {
    assert.match(text, new RegExp(EN[label]), 'the service action ' + label + ' is present');
  }
  assert.equal(text.split('Fun-ASR-Nano').length - 1, 1, 'the refinement model appears once');
  assert.ok(!text.includes('ECAPA'), 'the diarization model is not offered');
  assert.match(text, /hy-mt2-7b/, 'the local LM Studio model is reported');
  assert.equal(text.split('In use').length - 1, 1, 'the active model is named once');
  assert.match(text, /Current model: SenseVoice/, 'the library names the model in use');

  const labels = labelsOf(runtime);
  assert.ok(labels.includes(EN['settings.asr.autoStart']));
  assert.ok(labels.includes(EN['settings.llm.autoStart']));
});

test('a fresh install says there is no caption model instead of showing an empty select', async () => {
  const runtime = await openSettings({
    catalog: {
      activeId: '',
      entries: [
        { id: 'sensevoice', label: 'SenseVoice', backend: 'sensevoice', capability: 'live', downloaded: false, active: false, sizeLabel: '1.05 GB', selectable: true },
      ],
    },
  });
  const text = runtime.renderer.text();
  assert.match(text, new RegExp(EN['settings.asr.noLiveModel']));
  const select = selectByLabel(runtime, EN['settings.asr.liveModel']);
  assert.equal(select.props.value, '', 'nothing claims to be selected');
  assert.ok(optionTexts(select).some((option) => option.includes('Not downloaded')));
});

test('the cloud provider swaps the local model controls for its own fields', async () => {
  const runtime = await openSettings({ settings: { asrProvider: 'siliconflow' } });
  const labels = labelsOf(runtime);
  assert.ok(labels.includes(EN['settings.siliconflowModel']), 'the cloud model id is a field');
  assert.ok(!labels.includes(EN['settings.asr.liveModel']), 'there is no local caption model for a cloud provider');
  assert.ok(!labels.includes(EN['settings.liveChunkSeconds']), 'chunk length is a local concept');
  assert.match(runtime.renderer.text(), new RegExp(EN['settings.cloudNotice']));
});

test('no tab renders a raw dictionary key', async () => {
  const runtime = await openSettings();
  for (const tab of tabsOf(runtime)) {
    await runtime.renderer.click(String(tab.props.children));
    runtime.renderer.render();
    const text = runtime.renderer.text();
    assert.doesNotMatch(text, /settings\.[a-zA-Z]/, 'tab ' + tab.props.children + ' renders labels only');
  }
});

test('startup toggles are form fields, saved by the one Save button', async () => {
  const runtime = await openSettings();
  await runtime.renderer.click(EN['settings.section.services']);
  runtime.renderer.render();
  const toggle = runtime.renderer.findAll((node) => node.type === 'input'
    && node.props.type === 'checkbox' && node.props['aria-label'] === EN['settings.asr.autoStart'])[0];
  assert.ok(toggle, 'the ASR startup toggle exists');
  assert.equal(toggle.props.checked, true, 'the saved value is shown');

  const savesBefore = runtime.requests.filter((request) => request.method === 'settings').length;
  toggle.props.onChange({ target: { checked: false } });
  runtime.renderer.render();
  assert.equal(runtime.requests.filter((request) => request.method === 'settings').length, savesBefore,
    'toggling does not save the whole form behind the reader');

  await runtime.renderer.click(EN['settings.save']);
  await runtime.flush();
  const saved = runtime.requests.filter((request) => request.method === 'settings').pop();
  assert.equal(saved.payload.settings.asrAutoStart, false);
});

test('the dialog scrolls its body, and the save bar is outside the scrolling area', async () => {
  const runtime = await openSettings();
  const body = runtime.renderer.findAll((node) => String(node.props?.className || '').includes('mvm-settings-body'))[0];
  const footer = runtime.renderer.findAll((node) => String(node.props?.className || '').includes('mvm-settings-foot'))[0];
  const textOf = (node) => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    return textOf(node.props?.children);
  };
  const save = runtime.renderer.findAll((node) => node.type === 'button'
    && String(node.props.className || '').includes('mvm-button-primary')
    && textOf(node).includes(EN['settings.save']))[0];
  assert.ok(body, 'the dialog has a scrolling body');
  assert.ok(footer, 'the dialog has a footer');
  assert.equal(contains(body, save), false, 'the save button is not inside the scrolling body');
  assert.equal(contains(footer, save), true, 'the save button lives in the footer');
});
