import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

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

async function seed(dataDir) {
  await mkdir(join(dataDir, 'meetings'), { recursive: true });
  await writeFile(join(dataDir, 'meetings', 'meeting-a.json'), JSON.stringify({
    id: 'meeting-a', title: '支付流程评审', createdAt: '2026-10-20T02:00:00Z',
    transcript: '我们讨论了开票时机与退款流程。', minutes: { summary: '确定开票先于支付。', todos: [{ text: '输出开票时序表' }] },
  }), 'utf8');
  await writeFile(join(dataDir, 'meetings', 'meeting-b.json'), JSON.stringify({
    id: 'meeting-b', title: '全球账户方案', createdAt: '2026-10-22T02:00:00Z',
    transcript: '合并开户流程后需要补充人脸认证。', minutes: { summary: '合并开户与支配合规要求。' },
  }), 'utf8');
}

test('history Q&A answers from stored transcripts and minutes and cites the meetings', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '需要先完成开票时序表。' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-history-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await seed(dataDir);

  const service = createService();
  service.config.dataDir = dataDir;
  service.liveManager = null;
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmModel = 'test-model';
  service.config.llmProvider = 'lmstudio';

  const result = await service.askHistory('接下来要做什么？', { scope: 'all' });
  assert.equal(result.ok, true);
  assert.equal(result.result.answer, '需要先完成开票时序表。');
  assert.equal(result.result.sources.length, 2);
  const prompt = requests[0].messages[0].content;
  assert.ok(prompt.includes('支付流程评审'));
  assert.ok(prompt.includes('全球账户方案'));
  assert.ok(prompt.includes('开票先于支付'));
  assert.ok(prompt.includes('我们讨论了开票时机与退款流程。'));

  const scoped = await service.askHistory('开票时序是什么？', { scope: 'current', meetingId: 'meeting-a' });
  assert.equal(scoped.ok, true);
  const scopedPrompt = requests[1].messages[0].content;
  assert.ok(scopedPrompt.includes('支付流程评审'));
  assert.ok(!scopedPrompt.includes('全球账户方案'));
});

test('history Q&A is reachable through the Host route', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-history-route-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await seed(dataDir);
  let route;
  let service;
  apply({
    provide(name, value) { if (name === 'minutes') service = value; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register(definition) { if (definition.path === ROUTE) route = definition; return () => {}; } } }, effect: (fn) => fn() });
    },
  });
  service.config.dataDir = dataDir;
  service.liveManager = null;
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'ask-history', payload: { question: '有哪些风险？', options: { scope: 'all' } } }),
  }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.result.sources.length >= 1);
});
