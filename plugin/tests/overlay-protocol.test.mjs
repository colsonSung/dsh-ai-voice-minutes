import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopOverlay, DEFAULT_APPEARANCE } from '../overlay.js';

const FAKE_OVERLAY = `#!/usr/bin/env node
// A stand-in for the native overlay: it echoes the control events the reader
// would press, and records everything the plugin sends it.
import fs from 'node:fs';
const log = process.env.FAKE_OVERLAY_LOG;
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    fs.appendFileSync(log, line + '\\n');
    const event = JSON.parse(line);
    if (event.type === 'status') {
      process.stdout.write('not json at all\\n');
      process.stdout.write(JSON.stringify({ type: 'noise', detail: 'ignored' }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'control', detail: 'pause' }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'control', detail: 'resume' }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'control', detail: 'stop' }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'control', detail: 'language', value: 'ja' }) + '\\n');
    }
  }
});
setTimeout(() => process.exit(0), 4000);
`;

/** Wait for a condition instead of guessing how long the child needs. */
async function waitFor(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-minutes-overlay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, 'fake-overlay.mjs');
  const log = join(directory, 'sent.log');
  await writeFile(command, FAKE_OVERLAY, 'utf8');
  await writeFile(log, '', 'utf8');
  await chmod(command, 0o755);
  // The fake overlay records what the plugin sends it.
  process.env.FAKE_OVERLAY_LOG = log;
  return { directory, command, log };
}

test('the overlay control events reach the plugin', async (t) => {
  const { command, log } = await fixture(t);
  const received = [];
  const overlay = new DesktopOverlay({
    command,
    onControl: (detail, value) => { received.push(value ? detail + ':' + value : detail); },
  });
  await overlay.start();
  await waitFor(() => received.length === 4);
  assert.deepEqual(
    received,
    ['pause', 'resume', 'stop', 'language:ja'],
    'only the control events arrive, with their value'
  );
  await overlay.stop();
});

test('the plugin sends the appearance, the session and the state', async (t) => {
  const { command, log } = await fixture(t);
  const overlay = new DesktopOverlay({ command, appearance: { background: '#101014', text: '#f2f2f7', opacity: 0.85, compact: false } });
  await overlay.start();
  await overlay.send({ type: 'session', startedAt: 1793330000000 });
  await overlay.send({ type: 'state', paused: false, live: true });
  await overlay.updateAppearance({ background: '#000000', text: '#ffffff', opacity: 0.5, compact: true });

  const { readFile } = await import('node:fs/promises');
  const readSent = async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  await waitFor(async () => (await readSent()).some((event) => event.type === 'appearance' && event.background === '#000000'));
  await overlay.stop();
  const sent = await readSent();
  const appearance = sent.find((event) => event.type === 'appearance');
  assert.equal(appearance.background, '#101014', 'the appearance carries the colours');
  assert.equal(appearance.opacity, 0.85, 'the appearance carries the opacity');
  assert.equal(appearance.compact, false, 'the appearance carries the default layout');
  assert.ok(sent.some((event) => event.type === 'session' && event.startedAt === 1793330000000), 'the session start is sent');
  assert.ok(sent.some((event) => event.type === 'state' && event.live === true), 'the live state is sent');
  const last = sent.filter((event) => event.type === 'appearance').pop();
  assert.equal(last.background, '#000000', 'the appearance can be changed while it is open');
});

test('the live level reaches the overlay and the language pick comes back', async (t) => {
  const { command, log } = await fixture(t);
  const controls = [];
  const overlay = new DesktopOverlay({ command, onControl: (detail, value) => controls.push(detail + ':' + value) });
  await overlay.start();
  await waitFor(() => controls.length === 3);
  await overlay.send({ type: 'level', level: 0.42, source: 'mic' });
  await overlay.send({ type: 'language', language: 'ja', languages: ['zh', 'en', 'ja'] });
  await waitFor(async () => {
    const { readFile } = await import('node:fs/promises');
    const lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    return lines.some((line) => line.includes('"level"'));
  });
  await overlay.stop();
  assert.ok(controls.length >= 3, 'the control events still arrive');
});

test('the default appearance is a light card', () => {
  assert.equal(DEFAULT_APPEARANCE.background, '#f6f6f7');
  assert.equal(DEFAULT_APPEARANCE.text, '#1c1c1e');
  assert.equal(DEFAULT_APPEARANCE.compact, true);
});
