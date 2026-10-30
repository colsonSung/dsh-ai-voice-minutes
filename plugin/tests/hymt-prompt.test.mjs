import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { apply } from '../index.js';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function createService() {
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  });
  return service;
}

test('Hy-MT models receive their documented prompt format', () => {
  const service = createService();
  const chinese = service.translationInstruction('请确认进件流程', {
    targetLanguage: 'en', promptLanguage: 'zh', model: 'Hy-MT2-7B',
  });
  assert.ok(chinese.includes('将以下文本翻译为 `English`'), 'uses the Chinese task instruction');
  assert.ok(chinese.includes('只需要输出翻译后的结果'), 'asks for translation only');
  assert.ok(chinese.includes('请确认进件流程'), 'keeps the source text');

  const english = service.translationInstruction('请确认进件流程', {
    targetLanguage: 'en', promptLanguage: 'en', model: 'Hy-MT2-7B',
  });
  assert.ok(english.includes('Translate the following text into `English`'));
  assert.ok(english.includes('ONLY output the translated result'));
});

test('a glossary is injected with the terminology format', () => {
  const service = createService();
  const prompt = service.translationInstruction('进件要两天', {
    targetLanguage: 'en', promptLanguage: 'zh', model: 'Hy-MT2-7B',
    glossary: '进件 = onboarding\nKYC = customer identification',
  });
  assert.ok(prompt.includes('参考下面的翻译'), 'uses the terminology block');
  assert.ok(prompt.includes('`进件` 翻译成 `onboarding`'));
  assert.ok(prompt.includes('`KYC` 翻译成 `customer identification`'));
});

test('generic models keep the existing instruction', () => {
  const service = createService();
  const prompt = service.translationInstruction('hello', { targetLanguage: 'zh', model: 'qwen3.5-4b-mtp' });
  assert.ok(prompt.includes('You are a professional translator'));
  assert.ok(!prompt.includes('只需要输出翻译后的结果'));
});

test('the glossary is configurable in the translation settings', () => {
  assert.match(client, /translationGlossary/);
  assert.match(client, /settings\.glossary/);
});
