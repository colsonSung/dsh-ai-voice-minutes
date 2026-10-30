import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('Client registers a sidebar-owned main panel instead of the composer popover', () => {
  assert.match(source, /name:\s*'sidebar\.panellist'/);
  assert.match(source, /name:\s*'main'/);
  assert.doesNotMatch(source, /conversation\.composer\.dock/);
});

test('Client binds translations through the locale service', () => {
  assert.match(source, /ctx\.locale\.bind\(NS\)/);
});

test('file selection and transcription are separate actions with a hidden native input', () => {
  assert.match(source, /const onTranscribe\s*=/);
  assert.match(source, /className:\s*'mvm-file-input'/);
  assert.match(source, /\.mvm-file-input\{display:none\}/);
  const onFile = source.match(/const onFile\s*=[\s\S]*?\n\s*};/);
  assert.ok(onFile, 'onFile handler exists');
  assert.doesNotMatch(onFile[0], /uploadAudio|callHost\('transcribe'/);
});

test('page stylesheet uses theme tokens rather than hard-coded hex colors', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`;/);
  assert.ok(css, 'component-scoped stylesheet exists');
  assert.doesNotMatch(css[1], /#[0-9a-f]{3,8}\b/i);
  assert.match(css[1], /--dsw-alias-bg-layer-1/);
  assert.match(css[1], /--dsw-alias-label-primary/);
});

test('Client offers a quick live button in the Harness chrome', () => {
  assert.match(source, /name:\s*'conversation\.session\.header\.utilities'/);
  assert.match(source, /name:\s*'sidebar\.right\.tab\.document\.actions'/);
  assert.match(source, /id:\s*'ai-voice-minutes-quick-live'/);
  assert.match(source, /callHost\('live-active'/);
  assert.match(source, /callHost\('live-start'/);
  assert.match(source, /callHost\('live-overlay-open'/);
  assert.match(source, /React\.useState/);
  assert.doesNotMatch(source, /function QuickLiveButton\(\)\s*\{\s*const \[busy, setBusy\] = useState/);
});
