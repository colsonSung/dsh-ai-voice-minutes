import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('SiliconFlow provider sends authenticated transcription without persisting secrets', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'XingChenAGI/XingChenGSR-V1.0' }] }));
      } else {
        response.end(JSON.stringify({ text: '云端转写', segments: [{ start: 0, end: 1, text: '云端转写', speaker: '1' }] }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-siliconflow-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrProvider: 'siliconflow',
    siliconflowBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    siliconflowModel: 'XingChenAGI/XingChenGSR-V1.0',
  }), 'utf8');
  const service = createService();
  service.config.dataDir = dataDir;
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  const result = await service.transcribe({ base64: wav.toString('base64') }, { filename: 'cloud.wav' });
  assert.equal(result.ok, true);
  assert.equal(result.result.transcript, '云端转写');
  const transcription = requests.find((request) => request.url === '/v1/audio/transcriptions');
  assert.ok(transcription, 'cloud transcription endpoint was called');
  assert.match(transcription.headers.authorization, /^Bearer .+/);
  assert.ok(transcription.body.includes(Buffer.from('XingChenAGI/XingChenGSR-V1.0')));

  const health = await service.health();
  assert.equal(health.asr.alive, true);
  const settings = await service.writeSettings({ asrProvider: 'siliconflow' });
  assert.equal(settings.siliconflowApiKeySet, true);
  const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved, 'siliconflowApiKey'), false);
  assert.equal(Object.hasOwn(saved, 'apiKey'), false);
});
