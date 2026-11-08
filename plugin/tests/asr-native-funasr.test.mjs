import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGIN = fileURLToPath(new URL('../', import.meta.url));
const SERVER = join(PLUGIN, 'native/asr/local_asr_server.py');
const PYTHON = existsSync(join(PLUGIN, 'native/asr/runtime/venv/bin/python'))
  ? join(PLUGIN, 'native/asr/runtime/venv/bin/python')
  : 'python3';

/**
 * The offline worker decodes WAV through soundfile, so the test needs a
 * Python that can import it. A fresh clone has no runtime yet, and the
 * system Python usually has no soundfile either — so the test skips instead
 * of reporting a failure the machine cannot fix.
 */
function hasSoundfile() {
  const result = spawnSync(PYTHON, ['-c', 'import soundfile'], { stdio: 'ignore' });
  return result.status === 0;
}

const SKIP_WITHOUT_SOUNDFILE = hasSoundfile()
  ? false
  : 'this Python has no soundfile; run plugin/native/asr/download-fun-asr-nano.sh to install the offline runtime';
const FUN_FILES = [
  'config.yaml', 'configuration.json', 'multilingual.tiktoken', 'model.pt',
  'Qwen3-0.6B/config.json', 'Qwen3-0.6B/generation_config.json',
  'Qwen3-0.6B/merges.txt', 'Qwen3-0.6B/tokenizer.json',
  'Qwen3-0.6B/tokenizer_config.json', 'Qwen3-0.6B/vocab.json',
];

async function touch(path, contents = 'stub') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function wav(seconds) {
  const frames = Math.round(seconds * 16000);
  const data = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) data.writeInt16LE(Math.round(Math.sin(index / 20) * 100), index * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function freePort() {
  const { createServer } = await import('node:net');
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startStubServer(t, modelDir, stubDir) {
  const port = await freePort();
  const child = spawn(PYTHON, [
    SERVER, '--host', '127.0.0.1', '--port', String(port),
    '--backend', 'funasr', '--fun-asr-dir', modelDir, '--fun-asr-python', PYTHON,
  ], {
    env: { ...process.env, PYTHONPATH: stubDir, HF_HUB_OFFLINE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000).unref();
      }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`ASR server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { base, child };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`ASR server did not start: ${logs}`);
}

async function postFinalize(base, audio) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'meeting.wav');
  form.append('track', 'system');
  form.append('hotwords', 'KYC,退款');
  form.append('language', '中文');
  form.append('itn', 'false');
  return fetch(`${base}/finalize`, { method: 'POST', body: form });
}

test('funasr /finalize runs offline with a stub model, chunks long audio, and restores CTC offsets', { skip: SKIP_WITHOUT_SOUNDFILE }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'asr-native-funasr-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modelDir = join(directory, 'models', 'fun-asr-nano');
  for (const file of FUN_FILES) await touch(join(modelDir, file));
  const stubDir = join(directory, 'stub');
  await touch(join(stubDir, 'torch.py'), `
class _MPS:
    @staticmethod
    def is_available():
        return False
class _Backends:
    mps = _MPS()
backends = _Backends()
`);
  await touch(join(stubDir, 'funasr', '__init__.py'), '');
  await touch(join(stubDir, 'funasr', 'models', '__init__.py'), '');
  await touch(join(stubDir, 'funasr', 'models', 'fun_asr_nano', '__init__.py'), '');
  await touch(join(stubDir, 'funasr', 'models', 'fun_asr_nano', 'model.py'), `
import os
class FunASRNano:
    @staticmethod
    def from_pretrained(model=None, **kwargs):
        assert os.environ.get('HF_HUB_OFFLINE') == '1'
        assert os.path.isdir(model)
        return FunASRNano(), {'tokenizer': object(), 'frontend': object()}
    def inference(self, data_in, key=None, tokenizer=None, frontend=None, **kwargs):
        frames = len(data_in[0])
        hotwords = ','.join(kwargs.get('hotwords') or [])
        text = f"stub:{hotwords}:{kwargs.get('language')}:{kwargs.get('itn')}:{frames}"
        stamp = [{'token': 'x', 'start_time': 0.0, 'end_time': min(0.5, frames / 16000.0)}]
        return [{'text': text, 'timestamps': stamp}], {}
`);
  const { base } = await startStubServer(t, modelDir, stubDir);
  const response = await postFinalize(base, wav(65));
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const body = JSON.parse(responseText);
  assert.equal(body.engine, 'funasr');
  assert.equal(typeof body.elapsed, 'number');
  // 分块上限调整为 120 秒（摊薄 Fun-ASR 模型加载开销），65 秒音频只切 1 块
  assert.equal(body.segments.length, 1);
  assert.deepEqual(body.segments.map((segment) => segment.start), [0]);
  assert.deepEqual(body.segments.map((segment) => segment.end), [65]);
  assert.deepEqual(body.segments.map((segment) => segment.speaker), ['system']);
  assert.match(body.text, /stub:KYC,退款:中文:False/);
  assert.equal(body.segments[0].timestamps[0].start, 0);

  const pass1 = new FormData();
  pass1.append('file', new Blob([wav(1)], { type: 'audio/wav' }), 'clip.wav');
  pass1.append('hotwords', 'KYC,退款');
  pass1.append('language', '中文');
  pass1.append('itn', 'false');
  pass1.append('response_format', 'verbose_json');
  const pass1Response = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', body: pass1 });
  assert.equal(pass1Response.status, 200);
  const pass1Body = await pass1Response.json();
  assert.match(pass1Body.text, /stub:KYC,退款:中文:False/);
  assert.equal(pass1Body.segments[0].start, 0);
  assert.equal(pass1Body.segments[0].end, 1);
});

test('funasr missing model returns JSON detail without killing the service', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'asr-native-funasr-missing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stubDir = join(directory, 'stub');
  await touch(join(stubDir, 'funasr', 'models', 'fun_asr_nano', 'model.py'), 'class FunASRNano: pass\n');
  await touch(join(stubDir, 'torch.py'), 'class _M:\n    @staticmethod\n    def is_available(): return False\nclass _B:\n    mps=_M()\nbackends=_B()\n');
  const { base } = await startStubServer(t, join(directory, 'missing-model'), stubDir);
  const response = await postFinalize(base, wav(1));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.detail, /Fun-ASR|model\.pt/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('funasr decodes ECAPA speaker spans independently and offsets their CTC timestamps', { skip: SKIP_WITHOUT_SOUNDFILE }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'asr-native-funasr-spans-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = join(directory, 'spans.wav');
  await writeFile(audioPath, wav(5));
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('local_asr_server', sys.argv[2])
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
class StubWorker:
    def request(self, audio_path, **kwargs):
        return {'text': 'span', 'timestamps': [{'token': 'x', 'start_time': 0.0, 'end_time': 0.5}]}
server._FUN_ASR_WORKER = StubWorker()
rows = server.transcribe_fun_asr(sys.argv[1], speaker_chunks=[
    {'start': 0.0, 'end': 2.0, 'speaker': '发言人 1'},
    {'start': 2.0, 'end': 5.0, 'speaker': '发言人 2'},
])
print(json.dumps(rows, ensure_ascii=False))
`;
  const child = spawn(PYTHON, ['-c', script, audioPath, SERVER], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(code, 0, stderr);
  const rows = JSON.parse(stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.speaker), ['发言人 1', '发言人 2']);
  assert.deepEqual(rows.map((row) => [row.start, row.end]), [[0, 2], [2, 5]]);
  assert.equal(rows[1].timestamps[0].start, 2);
});
