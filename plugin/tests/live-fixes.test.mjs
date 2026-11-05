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

test('the live control bar stays inside the plugin column and the timer renders mm:ss', () => {
  // The bar used to be `position:fixed`, which centred it on the window and
  // pushed it across the plugin's left edge into the host sidebar.
  assert.match(source, /\.mvm-live-control-bar\{position:absolute/);
  assert.doesNotMatch(source, /\.mvm-live-control-bar\{[^}]*position:fixed/);
  assert.match(source, /\.mvm-workspace\.mvm-live-workspace\{[^}]*position:relative[^}]*overflow:hidden/);
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

test('large second-based timestamps are rebased without another unit conversion', () => {
  const match = source.match(/function relativeStarts\(items\) \{[\s\S]*?\n    \}/);
  assert.ok(match, 'relativeStarts is available as a real function');
  const relativeStarts = new Function(`return ${match[0]}`)();
  assert.deepEqual(relativeStarts([
    { start: 251801.322 }, { start: 251804.322 }, { start: 251807.322 },
  ]), [0, 3, 6]);
  assert.deepEqual(relativeStarts([{ start: 1 }, { start: 4 }]), [1, 4], 'small elapsed values are unchanged');
  assert.deepEqual(relativeStarts([{ start: 1793536087 }, { start: 1793536089 }]), [0, 2],
    'epoch seconds also become relative seconds');
});

test('speaker chips stay on one line at desktop and narrow widths', () => {
  assert.match(source, /\.mvm-speaker\{[^}]*white-space:nowrap/);
  assert.match(source, /\.mvm-speaker-chip\{[^}]*white-space:nowrap/);
  // The transcript row is the utterance layout: a flex head (badge, speaker,
  // time) with the text indented underneath, not the old three-column table.
  assert.match(source, /\.mvm-utterance-head\{display:flex/);
  assert.match(source, /\.mvm-utterance-speaker-name\{[^}]*white-space:nowrap/);
  assert.match(source, /\.mvm-utterance-text\{[^}]*padding-left:40px/);
  assert.match(source, /@media\(max-width:900px\)\{\.mvm-utterance-text\{padding-left:0\}/);
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

test('the voice book is collapsed by default and exposes samples and correction without deletion', () => {
  assert.match(source, /const \[voicebookOpen, setVoicebookOpen\] = React\.useState\(false\)/);
  assert.match(source, /const playVoiceSample = async \(profile, audioRef = voiceSampleRef\) =>/);
  assert.match(source, /mvm-voice-play/);
  assert.doesNotMatch(source, /callHost\('voice-delete'/);
  assert.doesNotMatch(source, /mvm-voice-delete/);
  assert.match(source, /voice\.unnamedGroup/);
});

test('the voice book opens as a popover that the page layout cannot squeeze', () => {
  assert.match(source, /\.mvm-voicebook-panel\{[^}]*position:absolute/);
  assert.match(source, /\.mvm-voicebook-trigger-wrap\{[^}]*position:relative/);
  assert.match(source, /\.mvm-voicebook-list\{flex:none/);
});

test('the settings button uses a gear instead of a sun', () => {
  assert.match(source, /settings: 'M12\.22 2h-\.44/);
  assert.doesNotMatch(source, /settings: 'M12 15\.5a3\.5 3\.5 0 1 0 0-7/);
});

test('summary action sits in the tab header and the breadcrumb is a back button', () => {
  assert.match(source, /mvm-detail-tabs-spacer/);
  assert.match(source, /detail\.regenerateMinutes/);
  assert.match(source, /mvm-back-button/);
  assert.match(source, /name: 'arrow-left'/);
  assert.match(source, /detail\.back/);
});
