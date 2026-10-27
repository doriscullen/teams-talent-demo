import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TeamsSnapshot } from '../../shared/contracts.ts';
import snapshotJson from './fixtures/teams-snapshot.json' with { type: 'json' };
import { clientState, readTeamsData, teamsModel } from '../server/teams-data.ts';
import { seedState, DOCSET_ID, REPO_ID, STD_ID } from '../server/seed.ts';

const snapshot = snapshotJson as TeamsSnapshot;

test('hides the read-only imported Teams project and keeps user-created ones', () => {
  const model = teamsModel(snapshot);
  assert.deepEqual(model.projects.map(p => p.id), ['carddemo', 'project-1a2b3c']);
  assert.ok(!model.sources.some(s => s.projectId === 'teams'));
});

test('a user-created project has no local repository or documents, so it shows empty', () => {
  const model = teamsModel(snapshot);
  assert.ok(model.projects.some(p => p.id === 'project-1a2b3c'));
  assert.deepEqual(model.sources.filter(s => s.projectId === 'project-1a2b3c'), []);
});

test('maps the project documents into one document set named after the project', () => {
  const model = teamsModel(snapshot);
  const docs = model.sources.filter(s => s.type === 'docs');
  assert.equal(docs.length, 1);
  const set = docs[0];
  assert.equal(set.id, DOCSET_ID);
  assert.equal(set.name, '信用卡营销交付文档');
  assert.equal(set.path, 'iCode Teams 已对接的 3 份设计文档');
  assert.equal(set.files, 3);
  assert.deepEqual(set.tree, [{ dir: 'teams/docs', files: ['cashback-contract.md'] }, { dir: 'workspace/carddemo-java-1025/docs/design/adr', files: ['ADR-009-marketing-integration.md', 'ADR-007-authentication-scope.md'] }]);
  assert.equal(set.titles!['teams/docs/cashback-contract.md'], '消费返现规则');
  assert.equal(set.fromTeams, true);
  const repo = model.sources.find(s => s.type === 'repo')!;
  assert.equal(repo.id, REPO_ID);
  assert.equal(repo.name, 'carddemo-java-1025');
  assert.deepEqual(model.sources.filter(s => s.projectId === 'carddemo').map(s => s.id), [REPO_ID, DOCSET_ID]);
});

test('the Teams owner is the admin entry and member "member" is the developer entry', () => {
  const { team } = teamsModel(snapshot);
  assert.equal(team.name, '信用卡研发团队');
  assert.equal(team.admin, 'owner');
  assert.equal(team.me, 'member');
  assert.equal(team.members.find(m => m.id === team.admin)!.name, '林悦');
  assert.equal(team.members.find(m => m.id === team.me)!.name, '陈晨');
  assert.equal(team.members.length, 6);
});

test('shared sessions come from Teams, keyed by member', () => {
  const { sessions } = teamsModel(snapshot);
  assert.equal(sessions.length, snapshot.sessions.length);
  const s = sessions.find(x => x.id === '3f2a9c41d7e0')!;
  assert.equal(s.owner, 'member');
  assert.equal(s.ownerName, '陈晨');
  assert.equal(s.updated, '2026-10-26 18:42');
  assert.equal(s.projectId, 'carddemo');
  assert.ok(s.messages > s.turns && s.tokens > 0);
});

test('client state merges Talents metadata into Teams sources and adds the team-level local document source', () => {
  const state = clientState(seedState(), snapshot);
  const repo = state.sources.find(s => s.id === REPO_ID)!;
  assert.equal(repo.commit!.sha, '4e1b7c2');
  assert.equal(repo.prs, 66);
  const set = state.sources.find(s => s.id === DOCSET_ID)!;
  assert.deepEqual(set.versions!.map(v => v.at), ['2026-10-27 09:05', '2026-10-26 10:00']);
  assert.equal(state.sources.find(s => s.id === STD_ID)!.projectId, null);
  assert.ok(state.sources.some(s => s.id === 's-sessions'));
  assert.ok(!('localSources' in state) && !('sourceMeta' in state));
});

test('reads the shared snapshot, then the seed copy, then an empty team', async () => {
  const base = await mkdtemp(join(tmpdir(), 'talents-teams-'));
  const shared = join(base, 'data'), seed = join(base, 'seed');
  assert.equal((await readTeamsData({ shared, seed })).from, 'none');
  await mkdir(join(seed, 'teams'), { recursive: true });
  await writeFile(join(seed, 'teams', 'snapshot.json'), JSON.stringify(snapshot));
  assert.equal((await readTeamsData({ shared, seed })).from, 'seed');
  await mkdir(join(shared, 'teams'), { recursive: true });
  await writeFile(join(shared, 'teams', 'snapshot.json'), JSON.stringify({ ...snapshot, team: { ...snapshot.team, name: '新团队' } }));
  const read = await readTeamsData({ shared, seed });
  assert.equal(read.from, 'shared');
  assert.equal(read.snapshot.team.name, '新团队');
});
