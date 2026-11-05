import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

// Pull one declaration block out of the plugin stylesheet.
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `${selector} has a rule in the plugin stylesheet`);
  return match[1];
}

test('the live control bar is positioned against the plugin column, never the viewport', () => {
  const bar = rule('.mvm-live-control-bar');
  assert.match(bar, /position:absolute/, 'the bar is laid out by the plugin, not by the window');
  assert.doesNotMatch(bar, /position:fixed/);
  assert.doesNotMatch(source, /\.mvm-live-control-bar\{[^}]*position:fixed/);
  assert.match(bar, /max-width:calc\(100% - 40px\)/, 'the width cap is container relative');
  assert.doesNotMatch(bar, /vw\b/, 'no viewport unit survives in the bar');
  // The positioned ancestor sits inside the plugin content column, so the
  // centred bar can never leave the column it belongs to.
  assert.match(rule('.mvm-live-container'), /position:relative/);
  assert.match(source, /\.mvm-workspace\.mvm-live-workspace\{[^}]*position:relative/);
});

test('the live control bar keeps its pill look and its vertical offset', () => {
  const bar = rule('.mvm-live-control-bar');
  assert.match(bar, /bottom:20px/);
  assert.match(bar, /z-index:30/);
  assert.match(bar, /border-radius:999px/);
  assert.match(bar, /border:1px solid var\(--mvm-line\)/);
  assert.match(bar, /box-shadow:var\(--mvm-shadow-float\)/);
});

test('only the intentional full-screen overlays stay viewport-fixed', () => {
  const fixed = [...source.matchAll(/\.([a-z0-9-]+)\{[^}]*position:fixed/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(fixed)].sort(),
    ['mvm-assistant-drawer', 'mvm-drawer-backdrop', 'mvm-settings-backdrop', 'mvm-share-backdrop'],
    'every remaining viewport-fixed rule is a deliberate full-screen overlay',
  );
});

test('the live view stretches to the host height and its columns scroll their own content', () => {
  // The page root is a definite-height flex column.
  assert.match(source, /\.mvm-page\{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden/);
  // The live workspace takes the remaining height and never scrolls as a page.
  const workspace = rule('.mvm-live-workspace');
  assert.match(workspace, /flex:1/);
  assert.match(workspace, /min-height:0/);
  assert.match(workspace, /display:flex;flex-direction:column/);
  assert.match(source, /\.mvm-workspace\.mvm-live-workspace\{[^}]*overflow:hidden[^}]*padding-bottom:0/);
  // The container and the grid take the rest of the column.
  const container = rule('.mvm-live-container');
  assert.match(container, /flex:1/);
  assert.match(container, /min-height:0/);
  const grid = rule('.mvm-studio-grid');
  assert.match(grid, /flex:1/);
  assert.match(grid, /min-height:0/);
  assert.match(grid, /grid-template-rows:minmax\(0,1fr\)/, 'one row that fills the workspace');
  assert.match(grid, /align-items:stretch/, 'both columns stretch to that row');
  // The columns are shrinkable flex columns, so their body is the scroller.
  const column = rule('.mvm-studio-column');
  assert.match(column, /min-height:0/);
  assert.match(column, /display:flex;flex-direction:column/);
  const events = rule('.mvm-live-events');
  assert.match(events, /flex:1/);
  assert.match(events, /min-height:0/);
  assert.match(events, /overflow-y:auto/);
});

test('the scroll area keeps room below the last line for the floating bar', () => {
  const events = rule('.mvm-live-events');
  const padding = events.match(/padding:10px 14px (\d+)px/);
  assert.ok(padding, 'the scroll area reserves space at the bottom');
  // The bar is 34px of control button plus 20px of padding, sitting 20px
  // above the bottom edge, so the last line has to clear 74px.
  assert.ok(Number(padding[1]) >= 74, `bottom padding ${padding[1]}px clears the floating bar`);
});

test('the live view renders both columns in the studio grid with the bar inside the live column', () => {
  assert.match(source, /className: 'mvm-workspace mvm-live-workspace'/);
  assert.match(source, /h\('div', \{ className: 'mvm-live-container' \},/);
  assert.match(source, /h\('div', \{ className: 'mvm-studio-grid' \},/);
  assert.match(source, /className: 'mvm-studio-column mvm-transcript-column'/);
  assert.match(source, /className: 'mvm-studio-column mvm-summary-column'/);
  assert.match(source, /className: 'mvm-live-events'/);
  assert.match(source, /className: 'mvm-playback-bar mvm-live-control-bar'/);
});

test('the other views keep their own scrolling rules', () => {
  assert.match(source, /\.mvm-workspace\{min-width:0;min-height:0;overflow-y:auto;padding:24px 28px 56px\}/);
  assert.match(source, /\.mvm-detail-page\{[^}]*height:100%[^}]*min-height:0[^}]*overflow:hidden/);
});
