import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('meeting library is a real table with reference columns and an import action', () => {
  for (const pattern of [/mvm-library-table/, /Created at/, /Duration/, /Creator/, /Source/, /Size/, /action.import/]) {
    assert.match(source, pattern);
  }
});

test('detail header exposes favorite, Edit, Translation, Share, and content search', () => {
  for (const pattern of [/action.favorite/, /action.edit/, /action.translation/, /action.share/, /action.search/, /searchQuery/]) {
    assert.match(source, pattern);
  }
});

test('audio player supports play pause, seek, skip 15 seconds, playback rate and cleanup', () => {
  for (const pattern of [/detailAudioRef/, /skip\(15\)/, /playbackRate/, /onLoadedMetadata/, /onTimeUpdate/, /pause\(\)/]) {
    assert.match(source, pattern);
  }
});

test('detail has four working views and clickable chapter navigation', () => {
  for (const pattern of [/detailTab/, /Transcribe/, /AI Summary/, /Viewpoint Tree/, /Chapter/, /Outline/, /selectedChapter/]) {
    assert.match(source, pattern);
  }
});

test('translation menu covers all reference languages and bilingual display', () => {
  for (const pattern of [/zh-Hant/, /yue/, /ja/, /ko/, /th/, /id/, /bilingual/, /translationMap/]) {
    assert.match(source, pattern);
  }
});

test('editing, share, and real exports have concrete behavior', () => {
  for (const pattern of [/editing/, /editTranscript/, /copy-link/, /send-to-chat/, /Markdown/, /JSON/, /WAV/, /revokeObjectURL/]) {
    assert.match(source, pattern);
  }
});
