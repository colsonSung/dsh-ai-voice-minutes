import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopOverlay } from '../overlay.js';

test('desktop overlay forwards live events and closes cleanly', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-minutes-overlay-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, 'events.jsonl');
  const script = join(directory, 'fake-overlay.mjs');
  await writeFile(script, `import { createInterface } from 'node:readline';\nimport { appendFile } from 'node:fs/promises';\nconst lines = createInterface({ input: process.stdin });\nfor await (const line of lines) { await appendFile(process.argv[2], line + '\\n'); if (JSON.parse(line).type === 'control') process.exit(0); }\n`, 'utf8');

  const overlay = new DesktopOverlay({ command: process.execPath, args: [script, log] });
  await overlay.start();
  await overlay.send({ type: 'transcript', chunkId: 1, source: 'mic', text: 'hello' });
  await overlay.stop();
  const content = await readFile(log, 'utf8');
  assert.match(content, /"text":"hello"/);
  assert.match(content, /"type":"control"/);
  assert.match(content, /"detail":"close"/);
  await overlay.start();
  await overlay.stop();
});
