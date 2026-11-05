import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const host = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('ASR settings exposes real service lifecycle and model management controls', () => {
  for (const method of ['asr-status', 'asr-start', 'asr-stop', 'asr-restart', 'asr-download-model', 'asr-select-model']) {
    assert.ok(source.includes(`onAsrAction('${method}'`) || source.includes(`callHost('${method}'`), `${method} is wired`);
  }
  assert.match(source, /settings\.asr\.serviceTitle/);
  assert.match(source, /settings\.asr\.download/);
  assert.match(source, /settings\.asr\.autoStart/);
  // Autostart ships on: a meeting needs the ASR service before its first
  // caption, and the settings file decides whether it starts.
  assert.match(host, /asrAutoStart:\s*true/);
  assert.match(host, /llmAutoStart:\s*true/);
  assert.match(host, /await service\.ensureSettings\(\)/, 'the boot hook reads the saved settings first');
  assert.match(host, /NODE_TEST_CONTEXT/, 'a test harness never spawns the real services');
});
