import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TeamsSnapshot } from '../../shared/contracts.ts';
import snapshotJson from './fixtures/teams-snapshot.json' with { type: 'json' };
import { clientState, ownedState } from '../server/teams-data.ts';
import { seedState, DOCSET_ID, REPO_ID } from '../server/seed.ts';
import { Store } from '../server/store.ts';

const snapshot = snapshotJson as TeamsSnapshot;
const roundTrip = (change: (client: any) => void) => {
  const previous = seedState(), client: any = structuredClone(clientState(previous, snapshot));
  change(client);
  return ownedState(JSON.parse(JSON.stringify(client)), previous);
};

test('saving strips Teams-derived team, projects, sessions and source fields', () => {
  const saved = roundTrip(client => {
    client.team.name = '被改掉的团队';
    client.projects[0].name = '被改掉的项目';
    client.sessions.push({ id: 'x' });
    client.sources.find((s: any) => s.id === DOCSET_ID).name = '被改掉的文档集';
    client.teams = { origin: 'x' };
  });
  for (const key of ['team', 'projects', 'sessions', 'sources', 'teams']) assert.ok(!(key in saved), key + ' should not be stored');
  assert.deepEqual(Object.keys(saved.sourceMeta[DOCSET_ID]).sort(), ['lastCheck', 'versions']);
  assert.deepEqual(Object.keys(saved.sourceMeta[REPO_ID]).sort(), ['commit', 'origin', 'prs']);
  assert.deepEqual(saved.localSources.map(s => s.id), ['s-std']);
});

test('saving keeps Talents metadata about Teams sources (document check, new version)', () => {
  const saved = roundTrip(client => {
    const set = client.sources.find((s: any) => s.id === DOCSET_ID);
    set.lastCheck = '2026-10-27 09:00';
    set.versions.unshift({ at: '2026-10-27 09:00', added: ['teams/docs/new.md'] });
  });
  assert.equal(saved.sourceMeta[DOCSET_ID].lastCheck, '2026-10-27 09:00');
  assert.equal(saved.sourceMeta[DOCSET_ID].versions!.length, 3);
});

test('a registered local document source is stored with the project it was registered in, or at team level', () => {
  const registered = (id: string, projectId?: string | null) => ({ id, type: 'docs', name: '会议纪要', path: '/Volumes/team-share/meeting-notes', files: 3, tree: [],
    from: { kind: 'shared' }, lastCheck: '2026-10-27 09:00', versions: [{ at: '2026-10-27 09:00', initial: 3 }], ...(projectId === undefined ? {} : { projectId }) });
  const saved = roundTrip(client => { client.sources.push(registered('s-project', 'carddemo'), registered('s-team', null), registered('s-unset')); });
  const local = (id: string) => saved.localSources.find(s => s.id === id)!;
  assert.equal(local('s-project').projectId, 'carddemo');
  assert.equal(local('s-project').name, '会议纪要');
  assert.ok(!('fromTeams' in local('s-project')));
  assert.equal(local('s-team').projectId, null);
  assert.equal(local('s-unset').projectId, null);
});

test('Talents-owned fields (tasks, artifacts, developer machine) are kept', () => {
  const saved = roundTrip(client => {
    client.tasks.unshift({ id: 't-new', cap: 'traj', sources: ['s-sessions'], sessions: ['3f2a9c41d7e0'] });
    client.dev.applied['a-docidx'] = { version: 2 };
    client.role = 'dev';
  });
  assert.equal(saved.tasks[0].id, 't-new');
  assert.deepEqual(saved.dev.applied['a-docidx'], { version: 2 });
  assert.equal(saved.role, 'dev');
});

test('the store checks the revision and writes every change', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'talents-store-')), 'state.json');
  const store = new Store(path); await store.init();
  const first = store.state.revision;
  await store.mutate(first, s => ({ ...s, role: 'dev' }));
  assert.equal(store.state.revision, first + 1);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).role, 'dev');
  await assert.rejects(store.mutate(first, s => s), (e: any) => e.status === 409);
  await store.reset();
  assert.equal(store.state.role, 'admin');
  assert.equal(store.state.revision, first + 2);
});
