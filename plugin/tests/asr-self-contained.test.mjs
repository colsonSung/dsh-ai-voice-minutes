import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const admin = await readFile(new URL('../asr-admin.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../native/asr/local_services.py', import.meta.url), 'utf8');
const server = await readFile(new URL('../native/asr/local_asr_server.py', import.meta.url), 'utf8');

test('ASR defaults and runtime are self-contained in the plugin bundle', () => {
  assert.match(admin, /native\/asr\/models/);
  assert.match(admin, /native\/asr\/local_services\.py/);
  assert.doesNotMatch(index, /onerway-business-systems|\.cache.*onerway-prototype-review/);
  assert.match(launcher, /STATE_DIR\s*=\s*Path\(__file__\)\.resolve\(\)\.parent\s*\/\s*"runtime"/);
  assert.match(launcher, /env\["HF_HOME"\]/);
  assert.match(server, /Path\(__file__\)\.resolve\(\)\.parent\s*\/\s*"models"/);
});
