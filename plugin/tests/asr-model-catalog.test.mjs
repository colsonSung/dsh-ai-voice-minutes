import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AsrAdmin } from '../asr-admin.js';

test('the model catalog tells which models are downloaded and which is in use', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-minutes-catalog-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'ggml-large-v3.bin'), Buffer.alloc(10));
  await writeFile(join(dir, 'ggml-large-v3-q5_0.bin'), Buffer.alloc(10));
  const admin = new AsrAdmin({ config: { asrModelDir: dir } });
  const catalog = await admin.catalog();
  assert.equal(catalog.entries.length, 11);
  const large = catalog.entries.find((entry) => entry.id === 'ggml-large-v3.bin');
  const q5 = catalog.entries.find((entry) => entry.id === 'ggml-large-v3-q5_0.bin');
  const tiny = catalog.entries.find((entry) => entry.id === 'ggml-tiny.bin');
  assert.equal(large.downloaded, true);
  assert.equal(q5.downloaded, true);
  assert.equal(tiny.downloaded, false);
  assert.equal(large.active, true, 'the default large-v3 is in use when nothing is configured');
  assert.equal(q5.active, false);
});

test('selecting a model moves the active flag', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-minutes-catalog-active-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'ggml-large-v3.bin'), Buffer.alloc(10));
  await writeFile(join(dir, 'ggml-large-v3-q5_0.bin'), Buffer.alloc(10));
  const admin = new AsrAdmin({ config: { asrModelDir: dir, whisperCppModel: join(dir, 'ggml-large-v3-q5_0.bin') } });
  const catalog = await admin.catalog();
  assert.equal(catalog.activeId, 'ggml-large-v3-q5_0.bin');
  assert.equal(catalog.entries.find((entry) => entry.id === 'ggml-large-v3-q5_0.bin').active, true);
});

test('any catalog model can be downloaded by id', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-minutes-catalog-download-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('ggml');
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const admin = new AsrAdmin({ config: { asrModelDir: dir } });
  const result = await admin.downloadModel({ id: 'ggml-large-v3-turbo-q5_0.bin', url: `http://127.0.0.1:${server.address().port}/model.bin` });
  assert.equal(result.downloaded, true);
  assert.ok(result.path.endsWith('ggml-large-v3-turbo-q5_0.bin'));
  assert.equal(await readFile(result.path, 'utf8'), 'ggml');
});

test('a downloaded model can be deleted but the active one is protected', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-minutes-catalog-delete-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'ggml-large-v3.bin'), Buffer.alloc(10));
  await writeFile(join(dir, 'ggml-small.bin'), Buffer.alloc(10));
  const admin = new AsrAdmin({ config: { asrModelDir: dir, whisperCppModel: join(dir, 'ggml-large-v3.bin') } });
  const active = await admin.deleteModel({ id: 'ggml-large-v3.bin' });
  assert.equal(active.ok, false, 'the active model cannot be deleted');
  const removed = await admin.deleteModel({ id: 'ggml-small.bin' });
  assert.equal(removed.ok, true);
  const catalog = await admin.catalog();
  assert.equal(catalog.entries.find((entry) => entry.id === 'ggml-small.bin').downloaded, false);
});
