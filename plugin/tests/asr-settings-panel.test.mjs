import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the ASR panel no longer offers a redundant default model download', () => {
  assert.doesNotMatch(source, /settings\.asr\.download'/);
  assert.doesNotMatch(source, /下载默认模型|Download default model/);
  // The per model download stays; only the blanket one is gone.
  assert.match(source, /onAsrAction\('asr-download-model', \{ id: entry\.id \}\)/);
});

test('the model library switches by catalog id, not by a path the host cannot resolve', () => {
  assert.match(source, /onAsrModelSelect\(entry\.id\)/);
  assert.doesNotMatch(source, /onAsrModelSelect\(entry\.path\)/);
  assert.match(source, /onAsrAction\('asr-select-model', \{ id \}\)/);
});

test('a model switch updates the form state so saving settings cannot revert it', () => {
  const select = source.match(/const onAsrModelSelect\s*=[\s\S]*?\n\s*};/);
  assert.ok(select, 'the model select handler exists');
  for (const key of ['asrBackend', 'whisperCppModel', 'senseVoiceDir', 'funAsrDir']) {
    assert.ok(select[0].includes(key), `${key} follows the switch`);
  }
  assert.match(select[0], /result\?\.settings/);
});

test('the diarization model is not offered as a transcription model', () => {
  assert.match(source, /entry\.selectable === false/);
});

test('the settings dialog shows its own error and notice instead of hiding them behind the backdrop', () => {
  const modal = source.match(/settingsOpen \?[\s\S]*?t\('settings\.save'\)/);
  assert.ok(modal, 'the settings dialog exists');
  assert.match(modal[0], /mvm-alert-error mvm-settings-alert/);
  assert.match(modal[0], /mvm-alert-notice mvm-settings-alert/);
  assert.match(source, /\.mvm-settings-alert\{margin:12px 0 0\}/);
});

test('the audio players keep the src that React owns', () => {
  const stop = source.match(/const stopDetailAudio\s*=[\s\S]*?\n\s*};/);
  assert.ok(stop, 'the detail stop handler exists');
  assert.doesNotMatch(stop[0], /removeAttribute|\.load\(\)/);
  const live = source.match(/const stopLivePlayback\s*=[\s\S]*?\n\s*};/);
  assert.ok(live, 'the live stop handler exists');
  assert.doesNotMatch(live[0], /removeAttribute/);
});

test('the play button sits beside the progress bar and the download is the complete audio', () => {
  const timeline = source.match(/h\('div', \{ className: 'mvm-player-timeline' \},([\s\S]*?)\n\s*renderAudioFiles\(\)/);
  assert.ok(timeline, 'the player timeline exists');
  assert.match(timeline[1], /onDetailPlayPause/);
  assert.ok(
    timeline[1].indexOf('onDetailPlayPause') < timeline[1].indexOf("type: 'range'"),
    'play and pause sit beside the progress bar, not in a separate row'
  );
  assert.match(timeline[1], /mvm-player-play/);
  assert.match(source, /file.kind === 'mix' \? 'detail.audioFull'/);
  assert.match(source, /'detail.audioDownload': 'Download full audio'/);
});

test('the player has directional skip buttons and an explicit playback speed menu', () => {
  assert.match(source, /className: 'mvm-skip-group'/);
  assert.match(source, /mvm-skip-button mvm-skip-back/);
  assert.match(source, /mvm-skip-button mvm-skip-forward/);
  assert.match(source, /'aria-label': t\('detail.skipBack'\)/);
  assert.match(source, /'aria-label': t\('detail.skipForward'\)/);
  assert.match(source, /className: 'mvm-rate-select'/);
  assert.match(source, /onChange: \(event\) => changePlaybackRate\(event.target.value\)/);
  assert.doesNotMatch(source, /onClick: cyclePlaybackRate/);
});
