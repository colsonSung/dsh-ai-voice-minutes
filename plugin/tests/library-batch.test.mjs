import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, ROUTE } from '../index.js';

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function service(t, dataDir) {
  let value = null;
  const routes = new Map();
  apply({
    provide(name, item) { if (name === 'minutes') value = item; },
    effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
    inject(dependencies, callback) {
      if (dependencies.includes('commands')) callback({ commands: { register: () => () => {} }, effect: (fn) => fn() });
      if (dependencies.includes('connection')) {
        callback({
          connection: { fetch: { register(definition) { routes.set(definition.path, definition); return () => {}; } } },
          effect: (fn) => fn(),
        });
      }
    },
  }, { dataDir, autoStartLocalServices: false });
  value.config.dataDir = dataDir;
  return { service: value, route: routes.get(ROUTE) };
}

async function invoke(route, method, payload = {}) {
  const response = await route.fetch(new Request('http://localhost' + ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }),
  }));
  return response.json();
}

async function seed(t, dataDir, meetings) {
  const { service: svc, route } = service(t, dataDir);
  for (const meeting of meetings) {
    await svc.saveMeeting({ realtime: false, source: 'Import', ...meeting });
  }
  return { service: svc, route };
}

test('archiving removes a meeting from Recent without deleting anything', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-archive-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { route } = await seed(t, dataDir, [
    { id: 'meeting-a', title: 'Alpha', transcript: 'alpha body' },
    { id: 'meeting-b', title: 'Beta', transcript: 'beta body' },
  ]);

  const archived = await invoke(route, 'archive-meetings', { ids: ['meeting-a'], archived: true });
  assert.equal(archived.ok, true);
  assert.deepEqual(archived.result.done, ['meeting-a']);
  assert.deepEqual(archived.result.failed, []);

  const stored = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-a.json'), 'utf8'));
  assert.equal(stored.archived, true, 'the record is marked');
  assert.ok(stored.archivedAt, 'the archive time is recorded');
  assert.equal(stored.transcript, 'alpha body', 'the transcript is untouched');

  const list = await invoke(route, 'list');
  const byId = new Map(list.result.meetings.map((meeting) => [meeting.id, meeting]));
  assert.equal(byId.get('meeting-a').archived, true, 'the list reports the flag');
  assert.equal(byId.get('meeting-b').archived, false);

  const unarchived = await invoke(route, 'archive-meetings', { ids: ['meeting-a'], archived: false });
  assert.deepEqual(unarchived.result.done, ['meeting-a']);
  const again = JSON.parse(await readFile(join(dataDir, 'meetings', 'meeting-a.json'), 'utf8'));
  assert.equal(again.archived, false);
  assert.equal(again.archivedAt, '');
});

test('batch archive reports the ids it could not finish instead of failing the whole batch', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-archive-partial-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { route } = await seed(t, dataDir, [{ id: 'meeting-ok', title: 'Fine', transcript: 'x' }]);

  const result = await invoke(route, 'archive-meetings', { ids: ['meeting-ok', 'meeting-missing'] });
  assert.equal(result.ok, true, 'one bad id does not fail the request');
  assert.deepEqual(result.result.done, ['meeting-ok']);
  assert.equal(result.result.failed.length, 1);
  assert.equal(result.result.failed[0].id, 'meeting-missing');
});

test('batch delete removes every record it is given', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-delete-many-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { route } = await seed(t, dataDir, [
    { id: 'meeting-1', title: 'One', transcript: 'one' },
    { id: 'meeting-2', title: 'Two', transcript: 'two' },
    { id: 'meeting-3', title: 'Three', transcript: 'three' },
  ]);

  const deleted = await invoke(route, 'delete-meetings', { ids: ['meeting-1', 'meeting-3'] });
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.result.done.sort(), ['meeting-1', 'meeting-3']);

  const names = await readdir(join(dataDir, 'meetings'));
  assert.deepEqual(names, ['meeting-2.json'], 'only the untouched meeting is left');

  const list = await invoke(route, 'list');
  assert.deepEqual(list.result.meetings.map((meeting) => meeting.id), ['meeting-2']);
});

test('an empty batch is a no-op rather than an error', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ai-minutes-batch-empty-'));
  t.after(() => rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { route } = await seed(t, dataDir, [{ id: 'meeting-keep', title: 'Keep', transcript: 'k' }]);
  const archived = await invoke(route, 'archive-meetings', { ids: [] });
  assert.equal(archived.ok, true);
  assert.deepEqual(archived.result.done, []);
  const names = await readdir(join(dataDir, 'meetings'));
  assert.deepEqual(names, ['meeting-keep.json'], 'nothing is touched');
});

test('the list has a checkbox column, a select-all header and a batch bar', () => {
  // The table is one row component: the header owns select-all, every row owns
  // its own checkbox, and the bar only exists while something is selected.
  assert.match(clientSource, /mvm-library-check-cell/, 'rows and the header carry a checkbox cell');
  assert.match(clientSource, /type: 'checkbox', className: 'mvm-check'/, 'the row checkbox is a real checkbox');
  assert.match(clientSource, /node\.indeterminate = some/, 'the select-all header shows the partial state');
  assert.match(clientSource, /mvm-batch-bar/, 'a batch bar exists');
  assert.match(clientSource, /librarySelection\.length \? h\('div', \{ className: 'mvm-batch-bar'/, 'the bar appears only with a selection');
  assert.match(clientSource, /onArchiveSelected/, 'the bar can archive');
  assert.match(clientSource, /onDeleteSelected/, 'the bar can delete');
  assert.match(clientSource, /library\.deleteSelectedConfirm/, 'deleting a batch asks first');
});

test('the archive scope is a filter of its own and archived rows say so', () => {
  assert.match(clientSource, /\['archived', 'library\.filter\.archived'\]/, 'there is an Archived tab');
  // Archived meetings never mix into the other scopes.
  assert.match(clientSource, /libraryFilter === 'archived' \? !meeting\.archived : meeting\.archived/, 'archived meetings leave the other tabs');
  assert.match(clientSource, /mvm-library-archived-pill/, 'an archived row is labelled');
  assert.match(clientSource, /onArchiveMeeting/, 'a single row can be archived too');
});

test('cards show a selection made in the list instead of carrying their own checkbox', () => {
  assert.doesNotMatch(clientSource, /mvm-meeting-card-check/, 'the card header does not carry a checkbox');
  // A meeting selected in the list keeps its tinted card when the reader
  // switches to the grid, so the batch bar and the selection stay in sync.
  assert.match(clientSource, /mvm-meeting-card\.is-selected/, 'a selected card is still marked');
});
