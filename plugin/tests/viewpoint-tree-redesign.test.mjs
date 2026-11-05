import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

// The stylesheet lives inside one template literal; pull a block out of it.
function cssBlock(from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `the stylesheet contains ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `the stylesheet contains ${to} after ${from}`);
  return source.slice(start, end);
}

const mindmap = () => cssBlock('.mvm-viewpoint-tree{', '@media(max-width:900px){.mvm-mindmap-comparison');

// The renderer that draws the Viewpoint Tree tab.
function renderSource() {
  const start = source.indexOf('const renderViewpointTab = () => {');
  assert.ok(start >= 0, 'the plugin renders a Viewpoint Tree tab');
  const end = source.indexOf('const renderChapterTab', start);
  assert.ok(end > start);
  return source.slice(start, end);
}

test('the tree carries one hue for structure and never rotates colours per theme', () => {
  const css = mindmap();
  // The first design painted topic 1 blue, topic 2 green, topic 3 amber and so
  // on, which both broke the colour budget and turned semantic colours into
  // decoration. Structure is one hue; semantics appear only where they mean
  // something.
  assert.doesNotMatch(css, /\.mvm-mindmap-group\.tone-\d/, 'no per-topic colour rotation');
  assert.doesNotMatch(renderSource(), /tone-\$\{|tone-' \+/, 'the renderer never adds a tone class');
  assert.match(css, /--mvm-accent/, 'the spine is drawn in the plugin accent');
  // The risk is the one place a semantic colour is allowed to appear.
  assert.match(css, /\.mvm-mindmap-risk-block\{[^}]*--mvm-warn/, 'the risk block is the semantic carrier');
});

test('the theme header numbers each theme and states what it holds', () => {
  const render = renderSource();
  assert.match(render, /mvm-mindmap-index/, 'each theme carries a number token');
  assert.match(render, /padStart\(2, '0'\)/, 'the number is zero padded');
  assert.match(render, /mvm-mindmap-title/, 'the theme title is its own element');
  assert.match(render, /mindmap\.views/, 'the header states how many claims the theme holds');
  assert.match(render, /mindmap\.risks/, 'the header states how many risks the theme holds');
  // A theme with no risk must not claim one.
  assert.match(render, /risks \? h\('span', \{ className: 'mvm-mindmap-meta-open' \}/, 'the risk count only renders when there is a risk');
});

test('a viewpoint reads in three steps: claim, evidence, risk', () => {
  const render = renderSource();
  assert.match(render, /mvm-mindmap-stance/, 'the claim is its own step');
  assert.match(render, /h\('p', \{ className: 'mvm-mindmap-detail' \}/, 'the evidence is a plain paragraph');
  // The evidence needs no label: weight and colour already separate it from
  // the claim, and a label would be a fourth text level in a three-level card.
  assert.doesNotMatch(render, /mindmap\.evidence/, 'the evidence carries no redundant label');
  assert.match(render, /mvm-mindmap-risk-block/, 'the risk gets its own block');
  assert.match(render, /name: 'alert'/, 'the risk carries an icon, not just a colour');
  assert.match(render, /t\('mindmap\.risk'\)/, 'the risk carries a text label');
});

test('topics fall back to a summary and a decision list, never to a fake risk', () => {
  const render = renderSource();
  // The old fallback labelled a topic summary "Summary" in English and put the
  // topic's decisions into the risk slot, so a list of agreed decisions was
  // painted as a warning.
  assert.doesNotMatch(render, /stance: 'Summary'/, 'no English literal leaks into the Chinese UI');
  assert.match(render, /risk: ''/, 'a topic fallback carries no risk');
  assert.match(render, /decisions: Array\.isArray\(topic\.decisions\)/, 'the decisions are carried as decisions');
  assert.match(render, /mvm-mindmap-decisions/, 'the decisions render as their own list');
  assert.match(render, /t\('mindmap\.decisions'\)/, 'the decision list is labelled');
});

test('no connector lines at all: the structure is three aligned columns', () => {
  const css = mindmap();
  // The design review asked twice: first for no rail down the whole tree, then
  // for the connector marks gone as well. Structure now comes from alignment.
  for (const connector of [
    '.mvm-mindmap-children::before',
    '.mvm-mindmap-group::before',
    '.mvm-mindmap-theme::after',
    '.mvm-mindmap-theme::before',
    '.mvm-mindmap-branch::before',
    '.mvm-mindmap-comparison::before',
  ]) {
    assert.equal(css.includes(connector), false, `${connector} must not exist: no connector lines`);
  }
  // Three repeated columns replace the lines: number, title and card share one
  // left axis, the statistics sit flush right against the card edge.
  assert.match(css, /\.mvm-mindmap-theme\{[^}]*grid-template-columns:24px minmax\(0,1fr\) auto/, 'the header is a three-column axis');
  assert.match(css, /\.mvm-mindmap-group\{[^}]*padding-left:36px/, 'the indentation puts the cards under the title column');
  assert.match(css, /\.mvm-mindmap-meta\{[^}]*justify-self:end/, 'the statistics close the right axis');
  // With no lines left, the theme title has to carry the group on type alone.
  assert.match(css, /\.mvm-mindmap-title\{[^}]*font-size:16px[^}]*font-weight:600/, 'the theme title is a panel-level heading');
  // The nodes are cards on the plugin surface, not tinted blocks.
  assert.match(css, /\.mvm-mindmap-branch\{[^}]*background:var\(--mvm-surface-1\)/, 'a node is a surface card');
  assert.match(css, /\.mvm-mindmap-branch\{[^}]*box-shadow:var\(--mvm-shadow-card\)/, 'a node carries the card shadow');
});

test('the redesign stays inside the type and spacing scale', () => {
  const css = mindmap();
  const sizes = [...css.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0, 'the block sets type');
  for (const size of sizes) {
    assert.ok([12, 13, 14, 16].includes(size), `font-size ${size}px is outside the plugin scale`);
  }
  assert.ok(sizes.includes(16), 'the theme title is 16px');
  assert.ok(sizes.includes(14), 'the claim is 14px');
  assert.ok(sizes.includes(13), 'body copy is 13px');
  assert.ok(sizes.includes(12), 'metadata is 12px');
  // Every spacing value in the block comes from the 4px ladder.
  for (const match of css.matchAll(/(?:gap|margin|padding)(?:-top|-bottom|-left|-right)?:([^;{}]+)/g)) {
    for (const value of match[1].split(/\s+/)) {
      const px = /^(-?\d+)px$/.exec(value.trim());
      if (!px) continue;
      const number = Math.abs(Number(px[1]));
      assert.equal(number % 4, 0, `spacing ${value} is off the 4px ladder`);
    }
  }
});
