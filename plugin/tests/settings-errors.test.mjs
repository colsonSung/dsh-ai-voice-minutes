import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../asr-admin.js', import.meta.url), 'utf8');

test('settings save never sends a click event and reports failures readably', () => {
  assert.ok(client.includes('onClick: () => onSettingsSave()'), 'save button does not pass the event');
  assert.doesNotMatch(client, /onClick: onSettingsSave\b/, 'no direct event handler for settings save');
  assert.match(client, /sanitizePayload\(payload \?\? \{\}\)/);
  assert.match(client, /error\.settingsSaveFailed/);
  assert.match(client, /error\.asrActionFailed/);
});

test('ASR start failures explain what to check', () => {
  assert.match(admin, /本地 ASR 启动失败/);
  assert.match(admin, /本地 ASR 启动后未就绪/);
  assert.match(admin, /请检查设置中的启动脚本与模型目录/);
});
