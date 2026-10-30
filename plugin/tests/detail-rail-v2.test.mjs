import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('right rail follows the reference layout: header, capability tiles, contextual suggestions, pinned composer', () => {
  assert.match(source, /mvm-rail-header/);
  assert.match(source, /mvm-rail-tile/);
  assert.match(source, /mvm-rail-composer/);
  assert.match(source, /mvm-rail-suggestion/);
  assert.match(source, /mvm-rail-scroll/);
  assert.match(source, /history\.suggestLabel/);
  assert.match(source, /history\.tileMindMap/);
  assert.match(source, /history\.tileKeyInsights/);
  assert.match(source, /setDetailTab\('viewpoints'\)/);
  assert.match(source, /setDetailTab\('summary'\)/);
  assert.match(source, /minutes\?\.decisions/);
  assert.match(source, /minutes\?\.todos/);
});
