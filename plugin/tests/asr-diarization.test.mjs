import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { apply, ROUTE } from '../index.js';

const PLUGIN = fileURLToPath(new URL('../', import.meta.url));
const ASR_DIR = join(PLUGIN, 'native/asr');
const PYTHON = existsSync(join(ASR_DIR, 'runtime/venv/bin/python'))
  ? join(ASR_DIR, 'runtime/venv/bin/python')
  : 'python3';

function runPython(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-c', code], { cwd: ASR_DIR });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error('python failed: ' + (stderr || stdout).slice(-400)));
    });
  });
}

test('a short turn from another speaker survives the span merge', async () => {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(ASR_DIR)})
import local_asr_server as S
spans = [
  {"start": 0.0, "end": 3.0, "speaker": "spk-1"},
  {"start": 3.2, "end": 4.0, "speaker": "spk-2"},
]
segments = [
  {"start": 0.0, "end": 3.0, "text": "a", "speaker": "spk-1"},
  {"start": 3.2, "end": 4.0, "text": "b", "speaker": "spk-2"},
]
attached = S.attach_speakers([dict(item) for item in segments], spans)
print(json.dumps({"merged": S.merge_spans(spans), "attached": attached}))
`;
  const result = JSON.parse(await runPython(script));
  assert.equal(result.merged.length, 2, 'both speakers survive the merge');
  assert.deepEqual(result.merged.map((span) => span.speaker), ['spk-1', 'spk-2']);
  assert.deepEqual(result.attached.map((segment) => segment.speaker), ['spk-1', 'spk-2']);
});

test('a label that the transcoder already knows is not overwritten', async () => {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(ASR_DIR)})
import local_asr_server as S
spans = [{"start": 0.0, "end": 3.0, "speaker": "spk-1"}]
segments = [{"start": 0.0, "end": 3.0, "text": "a", "speaker": "spk-2"}]
print(json.dumps(S.attach_speakers(segments, spans)))
`;
  const attached = JSON.parse(await runPython(script));
  assert.equal(attached[0].speaker, 'spk-2', 'the known speaker is kept');
});

test('the fun-asr rows carry the clustered speaker instead of the track name', async () => {
  const script = `
import inspect, json, sys
sys.path.insert(0, ${JSON.stringify(ASR_DIR)})
import local_asr_server as S
source = inspect.getsource(S.transcribe_fun_asr)
print(json.dumps({"uses_chunk_speaker": 'chunk.get("speaker") or track' in source}))
`;
  const result = JSON.parse(await runPython(script));
  assert.equal(result.uses_chunk_speaker, true);
});

function capturePlugin() {
  const routes = new Map();
  let service;
  apply({
    provide(name, value) {
      if (name === 'minutes') service = value;
    },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) {
        callback({ commands: { register: () => () => {} }, effect: (register) => register() });
      }
      if (dependencies.includes('connection')) {
        callback({
          connection: {
            fetch: {
              register(definition) {
                routes.set(definition.path, definition);
                return () => {};
              },
            },
          },
          effect: (register) => register(),
        });
      }
    },
  });
  return { route: routes.get(ROUTE), service };
}

test('a live meeting is labelled with the people in the recording, not the capture track', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      track: 'mic',
      spans: [
        { start: 0, end: 4, speaker: '发言人 1' },
        { start: 4, end: 9, speaker: '发言人 2' },
      ],
      voiceprints: {
        '发言人 1': [1, 0],
        '发言人 2': [0, 1],
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-speakers-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const sessionDir = join(dataDir, 'realtime', 'realtime-test');
  await (await import('node:fs/promises')).mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'mic.pcm'), Buffer.alloc(16000 * 2 * 10));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrBaseUrl: `http://127.0.0.1:${server.address().port}`,
  }), 'utf8');

  const { service } = capturePlugin();
  service.config.dataDir = dataDir;
  await service.readSettings();

  const meeting = {
    id: 'realtime-test',
    segments: [
      { start: 1, end: 2, text: '一', speaker: 'mic', source: 'mic', audioStart: 0, audioEnd: 5 },
      { start: 3, end: 4, text: '二', speaker: 'mic', source: 'mic', audioStart: 5, audioEnd: 10 },
      { start: 5, end: 6, text: '三', speaker: 'mic', source: 'mic', audioStart: 30, audioEnd: 40 },
    ],
  };
  const labelled = await service.labelLiveSpeakers(meeting, { maxSeconds: null });
  assert.equal(labelled.segments.length, 3);
  assert.notEqual(labelled.segments[0].speaker, 'mic', 'the track name is replaced');
  assert.notEqual(labelled.segments[0].speaker, labelled.segments[1].speaker, 'two speakers are told apart');
  assert.equal(labelled.segments[2].speaker, labelled.segments[1].speaker, 'a silent stretch keeps the last speaker');
  assert.ok(labelled.segments.every((segment) => segment.speaker !== 'mic'), 'no track name survives as a speaker');
  assert.ok(requests.some((url) => url.endsWith('/diarize')));
  assert.deepEqual(Object.keys(labelled.voiceprints || {}).sort(), [
    labelled.segments[0].speaker, labelled.segments[1].speaker,
  ].sort(), 'the global speaker labels retain their voiceprints for the voice library');
});

test('labeling an old live meeting rebuilds missing voiceprints from its retained audio', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      track: 'mic',
      spans: [{ start: 0, end: 5, speaker: '发言人 1' }],
      voiceprints: { '发言人 1': [1, 0] },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-legacy-voiceprint-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const id = 'realtime-legacy';
  const sessionDir = join(dataDir, 'realtime', id);
  await (await import('node:fs/promises')).mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'mic.pcm'), Buffer.alloc(16000 * 2 * 10));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({
    asrBaseUrl: `http://127.0.0.1:${server.address().port}`,
  }), 'utf8');
  const { service } = capturePlugin();
  service.config.dataDir = dataDir;
  await service.readSettings();
  await service.saveMeeting({
    id, title: 'Legacy meeting', transcript: 'legacy', realtime: true,
    segments: [{ start: 0, end: 5, audioStart: 0, audioEnd: 5, text: 'legacy', speaker: '发言人 1', source: 'mic' }],
  });

  const labelled = await service.labelVoice({ meetingId: id, speaker: '发言人 1', name: 'Legacy Person' });
  assert.equal(labelled.ok, true, 'the retained recording supplies the missing voiceprint');
  const record = await service.readMeetingRecord(id);
  assert.deepEqual(record.voiceprints['发言人 1'], [1, 0]);
  assert.equal(record.speakerLabels['发言人 1'], 'Legacy Person');
  const profiles = await service.loadVoiceProfiles();
  assert.ok(profiles.some((profile) => profile.name === 'Legacy Person'));
  const later = await service.resolveVoiceLabels({ 'Speaker 1': [1, 0] });
  assert.equal(later.labels['Speaker 1'], 'Legacy Person');
  assert.ok(requests.some((url) => url.endsWith('/diarize')));
});

test('the normal live stop path saves synchronous and background voiceprints', async () => {
  const source = await readFile(join(PLUGIN, 'index.js'), 'utf8');
  assert.match(source, /voiceprints: labelled\.voiceprints/);
  assert.match(source, /voiceprints: full\.voiceprints/);
});
