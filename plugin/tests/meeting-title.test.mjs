import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

function makeService() {
  let value;
  apply({
    provide(name, item) { if (name === 'minutes') value = item; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) callback({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => fn() });
    },
  });
  return value;
}

test('the meeting title is the title from the minutes, not the first spoken words', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-title-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = makeService();
  service.config.dataDir = dataDir;
  const spoken = '就先先是这个嘛，渠道维度OK嘛。第二个就是还是说那个嘛，退款币种维度嘛。';
  const saved = await service.saveMeeting({
    id: 'realtime-title-1',
    title: spoken.slice(0, 48),
    transcript: spoken,
    segments: [{ start: 0, end: 3, text: spoken, speaker: 'mic' }],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.result.meeting.title, spoken.slice(0, 48), 'before the minutes arrive the first words stand in');

  const withMinutes = await service.saveMeeting({
    id: 'realtime-title-1',
    title: spoken.slice(0, 48),
    transcript: spoken,
    segments: [{ start: 0, end: 3, text: spoken, speaker: 'mic' }],
    minutes: { title: '退款币种与渠道路由', summary: '结论' },
  });
  assert.equal(withMinutes.ok, true);
  assert.equal(withMinutes.result.meeting.title, '退款币种与渠道路由', 'the minutes title replaces the placeholder');
});

test('a title written by hand survives the minutes', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-title-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = makeService();
  service.config.dataDir = dataDir;
  const spoken = '这段是会议的第一句话。';
  await service.saveMeeting({
    id: 'realtime-title-2',
    title: '季度渠道评审',
    transcript: spoken,
    segments: [{ start: 0, end: 3, text: spoken, speaker: 'mic' }],
  });
  const updated = await service.saveMeeting({
    id: 'realtime-title-2',
    title: '季度渠道评审',
    transcript: spoken,
    segments: [{ start: 0, end: 3, text: spoken, speaker: 'mic' }],
    minutes: { title: '模型给的标题', summary: '结论' },
  });
  assert.equal(updated.result.meeting.title, '季度渠道评审', 'a name the reader chose is kept');
});

test('an update never brings a deleted meeting back', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-title-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = makeService();
  service.config.dataDir = dataDir;
  await service.saveMeeting({ id: 'realtime-gone-1', title: '会被删掉的会议', transcript: '正文' });
  await service.deleteMeeting('realtime-gone-1');
  const late = await service.updateMeeting('realtime-gone-1', { minutes: { summary: '后台迟到的纪要' } });
  assert.equal(late.ok, false, 'the late update is refused');
  const onDisk = await readFile(join(dataDir, 'meetings', 'realtime-gone-1.json'), 'utf8').catch(() => null);
  assert.equal(onDisk, null, 'the deleted meeting stays deleted');
});

test('the summary prompt asks the model for a title', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-title-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = makeService();
  service.config.dataDir = dataDir;
  const requests = [];
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '渠道退款币种评审', summary: '结论' }) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  service.config.llmBaseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  service.config.llmProvider = 'lmstudio';
  service.config.llmFallbackEnabled = false;
  const result = await service.summarize('会议转写正文', { title: '' });
  assert.equal(result.ok, true);
  const prompt = requests[0].messages.map((message) => message.content).join('\n');
  assert.match(prompt, /会议标题/, 'the model is asked for a title');
  assert.match(prompt, /不要照抄转写的第一句/, 'the title may not be the first spoken words');
  assert.equal(result.result.minutes.title, '渠道退款币种评审');
});
