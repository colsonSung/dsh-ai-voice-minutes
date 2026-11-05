import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the library table grid matches the number of rendered cells', () => {
  const grid = source.match(/\.mvm-library-row\{display:grid;grid-template-columns:([^;]+);/);
  assert.ok(grid, 'the row grid template exists');
  const columns = grid[1].trim().split(/\s+/);
  assert.equal(columns.length, 8, 'select, title, created, duration, creator, source, size and actions');

  // The declared minimum width must actually cover the content: the fixed
  // columns, the title column's minimum, the gaps and the row padding.
  // If it does not, the table overflows its own minimum and the last column
  // (the delete action) is pushed out of sight behind a horizontal scrollbar.
  const gap = Number((source.match(/\.mvm-library-row\{[^}]*gap:(\d+)px/) || [])[1]);
  const minWidth = Number((source.match(/\.mvm-library-row\{[^}]*min-width:(\d+)px/) || [])[1]);
  const padding = Number((source.match(/\.mvm-library-row\{[^}]*padding:[\d.]+px (\d+)px/) || [])[1]);
  const fixed = columns
    .map((column) => Number((column.match(/^(\d+)px$/) || [])[1] || 0))
    .reduce((sum, value) => sum + value, 0);
  const titleMin = Number((columns[1].match(/minmax\((\d+)px/) || [])[1]);
  const needed = fixed + titleMin + gap * (columns.length - 1) + padding * 2;

  assert.ok(gap > 0 && minWidth > 0 && padding > 0, 'the row declares a gap, a minimum width and a padding');
  assert.ok(
    minWidth >= needed,
    `min-width ${minWidth}px must cover the ${needed}px of content (${fixed} fixed + ${titleMin} title + ${gap * (columns.length - 1)} gaps + ${padding * 2} padding)`,
  );
});

test('the table fits the narrowest panel without a horizontal scrollbar', () => {
  const minWidth = Number((source.match(/\.mvm-library-row\{[^}]*min-width:(\d+)px/) || [])[1]);
  // Below this the table would start scrolling sideways, which is what pushed
  // the actions column off screen before.
  assert.ok(minWidth < 900, `the minimum width (${minWidth}px) stays inside the narrowest panel`);
  assert.match(source, /\.mvm-library-table\{[^}]*overflow-x:auto/, 'the table keeps a sideways fallback for very narrow panels');
});

test('sizes are formatted and the delete action has its own column', () => {
  assert.match(source, /formatBytes\(meeting\.size\)/);
  assert.match(source, /mvm-library-actions/);
});
