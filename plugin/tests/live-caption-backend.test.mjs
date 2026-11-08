import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const host = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../native/asr/local_asr_server.py', import.meta.url), 'utf8');
const liveSource = await readFile(new URL('../live.js', import.meta.url), 'utf8');
const asrAdminSource = await readFile(new URL('../asr-admin.js', import.meta.url), 'utf8');

const { AsrAdmin } = await import('../asr-admin.js');

test('Fun-ASR is never a live caption backend', () => {
  // Measured on the reader's own recording: a 3-second caption chunk took 28.2s
  // on Fun-ASR (weights reloaded per request) against 0.52s on SenseVoice.
  // Fun-ASR is the pass-2 refinement model instead.
  assert.match(asrAdminSource, /export const LIVE_BACKENDS = \['whispercpp', 'sensevoice'\]/, 'the live backend allowlist excludes Fun-ASR');
  assert.match(asrAdminSource, /if \(configured === 'funasr'\) return 'sensevoice'/, 'a saved funasr setting migrates to a fast backend');
  assert.match(asrAdminSource, /capability: 'refine'/, 'the catalog knows Fun-ASR is the refinement model');
  assert.match(asrAdminSource, /refine: entry\.capability === 'refine'/, 'the catalog derives the refiner from that capability');
  assert.match(asrAdminSource, /selectable: entry\.capability === 'live'/, 'only live models are selectable as the caption backend');
});

test('the refinement pass still always uses Fun-ASR', () => {
  // Whatever the live backend is, /finalize must keep the Fun-ASR worker, and
  // the launcher arguments must keep passing its model and runtime.
  const finalize = server.slice(server.indexOf('async def finalize'));
  assert.match(finalize, /transcribe_fun_asr\(/, 'finalize transcribes with Fun-ASR');
  assert.match(asrAdminSource, /'--fun-asr-dir', paths\.funasr/, 'the launcher always passes the Fun-ASR model');
  assert.match(asrAdminSource, /'--fun-asr-python'/, 'the launcher always passes the Fun-ASR runtime');
});

test('live caption chunks never run speaker clustering', () => {
  // Speaker labels come from the whole track when the meeting ends; running
  // ECAPA on every three-second slice only delays the text.
  assert.match(liveSource, /live: true/, 'the live path marks its requests');
  assert.match(host, /if \(opts\.live\) fields\.diarize = 'false'/, 'the live request turns diarization off');
  assert.match(server, /diarize: str = Form\(""\)/, 'the service accepts a per-request diarization switch');
  assert.match(server, /want_diarize/, 'the handler uses the per-request switch');
  // An imported file is transcribed once and keeps its speaker clusters.
  assert.match(server, /speaker_chunks=speaker_chunks if STATE\["diarize"\] else None,\s*\n\s*track=track,/, 'the refinement pass keeps inline diarization');
});

test('the panel says which model refines and which one runs live', () => {
  assert.match(source, /settings\.asr\.refineModel/, 'the refiner keeps its own block');
  assert.match(source, /asrStatus\.refine\.ready/, 'the refine badge reads the catalog state');
  assert.match(source, /capability === 'live'/, 'the caption picker only offers live backends');
  assert.match(source, /settings\.asr\.refineHint/, 'the settings explain why Fun-ASR is not the live backend');
});

test('AsrAdmin maps a saved funasr setting without throwing', () => {
  const admin = new AsrAdmin({ config: { asrBackend: 'funasr' } });
  assert.equal(admin.backend(), 'sensevoice');
  const whisper = new AsrAdmin({ config: { asrBackend: 'whispercpp' } });
  assert.equal(whisper.backend(), 'whispercpp');
  const bad = new AsrAdmin({ config: { asrBackend: 'nonsense' } });
  assert.throws(() => bad.backend(), /未知 ASR 后端/);
});
