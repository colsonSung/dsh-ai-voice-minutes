import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function withModel(t, reply, run) {
  const prompts = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      prompts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const service = createService();
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  await run(service, prompts);
}

test('each template asks for its own output structure', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-template-prompt-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await withModel(t, '{"summary":"s"}', async (service, prompts) => {
    service.config.dataDir = dataDir;
    const visual = await service.summarize('一段会议内容', { template: 'visual-summary' });
    assert.equal(visual.ok, true);
    assert.ok(prompts[0].messages[1].content.includes('highlights'), 'visual summary asks for highlights');

    const classic = await service.summarize('一段会议内容', { template: 'classic' });
    assert.ok(prompts[1].messages[1].content.includes('background'), 'classic asks for background');
    assert.ok(prompts[1].messages[1].content.includes('conclusion'), 'classic asks for a conclusion');

    const minutes = await service.summarize('一段会议内容', { template: 'meeting-minutes' });
    assert.ok(prompts[2].messages[1].content.includes('actions'), 'meeting minutes ask for actions');
    assert.ok(prompts[2].messages[1].content.includes('openItems'), 'meeting minutes ask for open items');
  });
});

test('the template keeps its own fields and is recorded with the meeting', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-template-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await withModel(t, '{"summary":"s","highlights":[{"title":"要点","detail":"细节"}]}', async (service) => {
    service.config.dataDir = dataDir;
    const result = await service.summarize('一段会议内容', { template: 'visual-summary' });
    assert.equal(result.result.minutes.highlights[0].title, '要点');
    assert.equal(result.result.template, 'visual-summary');

    const saved = await service.saveMeeting({
      id: 'meeting-template-1', title: '模板会议', transcript: '逐字稿',
      minutes: result.result.minutes, template: result.result.template,
    });
    assert.equal(saved.ok, true);
    const onDisk = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-template-1.json'), 'utf8'));
    assert.equal(onDisk.template, 'visual-summary');
  });
});

test('the client restores the template of a meeting and renders its sections', () => {
  assert.match(client, /setSelectedTemplate\(meeting\.template/);
  assert.match(client, /template:\s*selectedTemplate/);
  assert.match(client, /mins\.highlights/);
  assert.match(client, /mins\.actions/);
  assert.match(client, /mins\.openItems/);
  assert.match(client, /mins\.background/);
  assert.match(client, /minutes\?\.template/);
});
