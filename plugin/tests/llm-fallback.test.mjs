import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

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

async function serviceWith(t, prefix) {
  const dataDir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = createService();
  service.config.dataDir = dataDir;
  return service;
}

const MINUTES_JSON = JSON.stringify({
  summary: '会议纪要',
  topics: [],
  chapters: [],
  decisions: [],
  todos: [],
  viewpoints: [],
});

test('the minutes LLM has a fallback slot that is off until it is configured', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-fallback-defaults-');
  assert.equal(service.config.llmFallbackEnabled, false);
  assert.equal(service.config.llmFallbackProvider, 'lmstudio');
  assert.equal(service.config.llmFallbackBaseUrl, 'http://127.0.0.1:6121/v1');
  assert.equal(service.config.llmFallbackPath, '/chat/completions');
  assert.equal(service.config.llmFallbackModel, '');
});

test('a failed minutes model falls back to the local model', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-fallback-');
  service.config.llmProvider = 'minimax';
  service.config.llmModel = 'MiniMax-M3.1-Flash';
  service.config.llmFallbackEnabled = true;
  service.config.llmFallbackProvider = 'lmstudio';
  service.config.llmFallbackModel = 'qwen3.5-9b-mtp';
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    if (options.profile?.provider === 'minimax') return { ok: false, error: { message: 'primary unavailable' } };
    return { ok: true, result: { text: 'local answer' } };
  };
  const result = await service.ask('逐字稿', '这次会议定下了什么？');
  assert.equal(result.ok, true);
  assert.equal(result.result.answer, 'local answer');
  assert.equal(result.result.provider, 'lmstudio');
  assert.equal(result.result.fallbackUsed, true);
  assert.match(result.result.primaryError, /primary unavailable/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].profile.model, 'MiniMax-M3.1-Flash');
  assert.equal(calls[1].profile.model, 'qwen3.5-9b-mtp');
});

test('the minutes fallback can be switched off without changing the primary', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-no-fallback-');
  service.config.llmProvider = 'minimax';
  service.config.llmModel = 'MiniMax-M3.1-Flash';
  service.config.llmFallbackEnabled = false;
  service.config.llmFallbackModel = 'qwen3.5-9b-mtp';
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    return { ok: false, error: { message: 'primary unavailable' } };
  };
  const result = await service.ask('逐字稿', '问题');
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile.provider, 'minimax');
});

test('minutes fall back when the primary answers with unparsable JSON', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-fallback-json-');
  service.config.llmProvider = 'minimax';
  service.config.llmModel = 'MiniMax-M3.1-Flash';
  service.config.llmFallbackEnabled = true;
  service.config.llmFallbackProvider = 'lmstudio';
  service.config.llmFallbackModel = 'qwen3.5-9b-mtp';
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    if (options.profile?.provider === 'minimax') return { ok: true, result: { text: '抱歉，我不能完成这个任务。' } };
    return { ok: true, result: { text: MINUTES_JSON } };
  };
  const result = await service.summarize('逐字稿', { title: '评审会' });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.minutes.summary, '会议纪要');
  assert.equal(result.result.fallbackUsed, true);
  assert.equal(result.result.provider, 'lmstudio');
  assert.equal(calls.length, 2);
});

test('a working primary model never reaches the fallback', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-primary-wins-');
  service.config.llmProvider = 'minimax';
  service.config.llmModel = 'MiniMax-M3.1-Flash';
  service.config.llmFallbackEnabled = true;
  service.config.llmFallbackModel = 'qwen3.5-9b-mtp';
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    return { ok: true, result: { text: MINUTES_JSON } };
  };
  const result = await service.summarize('逐字稿', { title: '评审会' });
  assert.equal(result.ok, true);
  assert.equal(result.result.fallbackUsed, false);
  assert.equal(result.result.provider, 'minimax');
  assert.equal(calls.length, 1);
});

test('the fallback keeps its own reasoning effort instead of the primary one', async (t) => {
  const service = await serviceWith(t, 'ai-minutes-llm-fallback-effort-');
  service.config.llmProvider = 'minimax';
  service.config.llmModel = 'MiniMax-M3.1-Flash';
  service.config.llmReasoningEffort = 'low';
  service.config.llmFallbackEnabled = true;
  service.config.llmFallbackModel = 'qwen3.5-9b-mtp';
  service.config.llmFallbackReasoningEffort = 'none';
  const calls = [];
  service.chat = async (_messages, options) => {
    calls.push(options);
    if (options.profile?.provider === 'minimax') return { ok: false, error: { message: 'primary unavailable' } };
    return { ok: true, result: { text: 'local answer' } };
  };
  await service.ask('逐字稿', '问题');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].reasoningEffort, 'low', 'the primary keeps its own effort');
  assert.equal(calls[1].reasoningEffort, 'none', 'the fallback does not inherit the primary effort');
});
