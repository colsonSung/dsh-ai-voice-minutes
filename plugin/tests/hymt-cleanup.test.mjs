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

test('the Hy-MT prompt keeps the source text out of backticks', () => {
  const service = createService();
  const prompt = service.translationInstruction('请确认进件流程', {
    targetLanguage: 'en', promptLanguage: 'zh', model: 'hy-mt2-7b',
  });
  assert.ok(prompt.includes('将以下文本翻译为 `English`'));
  assert.ok(prompt.includes('请确认进件流程'));
  assert.ok(!prompt.includes('`请确认进件流程`'), 'the source text is not wrapped in backticks');
});

test('translations are stripped of model-added backticks and labels', () => {
  const service = createService();
  assert.equal(service.cleanTranslation('`Hello there`'), 'Hello there');
  assert.equal(service.cleanTranslation('译文：你好'), '你好');
  assert.equal(service.cleanTranslation('Translation: hello'), 'hello');
  assert.equal(service.cleanTranslation('```\nhello\n```'), 'hello');
  assert.equal(service.cleanTranslation('  正常译文  '), '正常译文');
});

test('the comparison builds a prompt for each compared model', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /translationInstruction\(sentence, \{ \.\.\.options, model \}\)/);
});

test('the client exposes the served Hy-MT model for selection', () => {
  assert.match(client, /availableModels/);
  assert.match(client, /settings\.loadModels/);
});
