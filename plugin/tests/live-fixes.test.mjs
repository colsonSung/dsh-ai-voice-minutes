import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('only the explicit End meeting actions stop the capture', () => {
  const stops = source.match(/callHost\('live-stop'/g) || [];
  assert.equal(stops.length, 2, 'the capture stops from the live bar and from the meeting page');
  assert.match(source, /const onLiveStop = async \(\) => \{/);
  assert.match(source, /const onEndMeeting = async \(\) => \{/);
});

test('the live control bar is fixed to the viewport and the timer renders mm:ss', () => {
  assert.match(source, /\.mvm-live-control-bar\{position:fixed/);
  assert.match(source, /\.mvm-live-workspace\{padding-bottom:104px\}/);
  assert.match(source, /function formatClock\(value\)/);
  assert.match(source, /const elapsedLabel = formatClock\(elapsed\)/);
});

test('a running recording is re-attached after switching pages or plugins', () => {
  assert.match(source, /callHost\('live-active'\)/);
  assert.match(source, /const syncLiveActive = React\.useCallback/);
  assert.match(source, /void syncLiveActive\(\)/);
  assert.match(source, /library\.liveBanner/);
});

test('speakers fall back to consistent A/B/C letters and timestamps are relative', () => {
  assert.match(source, /function speakerLetterMap\(items\)/);
  assert.match(source, /function relativeStarts\(items\)/);
  assert.match(source, /'speaker\.letter'\)\.replace\('\{letter\}'/);
  assert.match(source, /const timeOf = \(index\) =>/);
  assert.match(source, /formatClock\(starts\[index\]\)/);
});

test('live transcript timestamps are rebased to the recording start', () => {
  assert.match(source, /const liveTimeBase = numericTimes\.length \? Math\.min\(\.\.\.numericTimes\) : 0/);
  assert.match(source, /liveTimeBase >= 86400000/);
  assert.match(source, /rebase \? liveTimeBase : 0/);
  assert.match(source, /renderLiveTranscriptEntry\(event, index, liveTimeLabel\)/);
});

test('the in-progress library badge is a small inline pill instead of a full bar', () => {
  assert.match(source, /mvm-library-progress-pill is-inline/);
  assert.match(source, /mvm-pulse-dot/);
  assert.doesNotMatch(source, /className: 'mvm-library-progress'/);
});

test('the voice book is collapsed by default and exposes samples and deletion', () => {
  assert.match(source, /const \[voicebookOpen, setVoicebookOpen\] = React\.useState\(false\)/);
  assert.match(source, /const playVoiceSample = async \(profile\) =>/);
  assert.match(source, /mvm-voice-play/);
  assert.match(source, /callHost\('voice-delete'/);
  assert.match(source, /voice\.unnamedGroup/);
});

test('summary action sits in the tab header and the breadcrumb is a back button', () => {
  assert.match(source, /mvm-detail-tabs-spacer/);
  assert.match(source, /detail\.regenerateMinutes/);
  assert.match(source, /mvm-back-button/);
  assert.match(source, /'←'/);
  assert.match(source, /detail\.back/);
});
