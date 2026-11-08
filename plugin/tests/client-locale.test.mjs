import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('locale registration recovers from the previous plugin dictionary generation', () => {
  let definition;
  const window = {
    __ModuleLoader__: {
      load(value) { definition = value; },
    },
  };
  vm.runInNewContext(source, { window, console });

  const dictionaries = {
    '@local/ai-voice-minutes': {
      en: { 'status.asr': 'ASR service', 'status.online': 'online' },
      zh: { 'status.asr': '转写服务', 'status.online': '在线' },
    },
  };
  const registrations = [];
  const locale = {
    bind(ns) {
      return (key) => dictionaries[ns]?.en?.[key] ?? key;
    },
    register(ns, dicts) {
      for (const [language, entries] of Object.entries(dicts)) {
        if (dictionaries[ns]?.[language]) throw new Error(`locale namespace "${ns}" already has locale "${language}"`);
      }
      dictionaries[ns] = dicts;
      return () => {};
    },
  };
  const ctx = {
    locale,
    effect: (register) => register(),
    slots: {
      inject: (name, register) => register(),
      register(options) {
        registrations.push(options);
        return () => {};
      },
    },
  };
  const plugin = definition.factory(() => ({ createElement: () => null }));
  plugin.apply(ctx);

  const sidebar = registrations.find((entry) => entry.name === 'sidebar.panellist');
  const main = registrations.find((entry) => entry.name === 'main');
  const t = locale.bind(main.locale);
  assert.equal(t('app.title'), 'Local AI Voice Minutes');
  assert.equal(t('action.new'), 'New meeting');
  assert.equal(t('action.transcribe'), 'Transcribe');
  assert.equal(sidebar.label(), 'Minutes');
});

test('the summary template badge resolves kebab-case template ids to locale labels', () => {
  assert.match(source, /const templateLabel = \(id\) =>/);
  assert.match(source, /library\.template\.' \+ value\.replace\(\/-\(\[a-z\]\)\/g/);
  assert.doesNotMatch(source, /t\('library\.template\.' \+ \(minutes\?\.template \|\| selectedTemplate\)\)/);
});

test('the English dictionary carries English template names', () => {
  assert.ok(source.includes("'library.template.intelligentSlicing': 'Intelligent Slicing'"));
  assert.ok(source.includes("'library.template.visualSummary': 'Visual Summary'"));
});
