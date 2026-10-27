import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error Node 24 runs the repository launcher as ESM.
import { configuredProjects, projectHealth } from '../../scripts/service-projects.mjs';

test('root launcher respects service-local config without leaking retired Talent state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'service-projects-'));
  try {
    await mkdir(join(root, 'teams/.local'), { recursive: true });
    await mkdir(join(root, 'talents/.local'), { recursive: true });
    await writeFile(join(root, 'teams/.local/config.json'), JSON.stringify({ DEMO_PORT: 46220, DEMO_STATE_DIR: join(root, 'saved-teams'), DEMO_TALENT_STATE_DIR: join(root, 'retired-talent') }));
    await writeFile(join(root, 'talents/.local/config.json'), JSON.stringify({ DEMO_TALENT_PORT: 46221, DEMO_TALENT_STATE_DIR: join(root, 'new-talents') }));
    const [teams, talents] = configuredProjects(root, {});
    assert.equal(teams.port, 46220);
    assert.equal(teams.stateRoot, join(root, 'saved-teams'));
    assert.equal(talents.port, 46221);
    assert.equal(talents.stateRoot, join(root, 'new-talents'));
    assert.notEqual(talents.env.DEMO_TALENT_STATE_DIR, teams.env.DEMO_TALENT_STATE_DIR);
    assert.equal(configuredProjects(root, { DEMO_PORT: '46222' })[0].port, 46222);
    await writeFile(join(root, 'teams/.local/config.json'), '{broken');
    assert.throws(() => configuredProjects(root, {}), /JSON/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('root launcher never adopts or stops another checkout on a matching port', async () => {
  const project = { port: 46220, app: 'teams-talent-carddemo', dir: '/expected/teams', stateRoot: '/expected/state' };
  const valid = { app: project.app, workspaceRoot: project.dir, stateRoot: project.stateRoot, pid: 456 };
  const respond = (body: object) => async () => new Response(JSON.stringify(body));
  assert.equal((await projectHealth(project, respond(valid))).pid, 456);
  for (const change of [{ workspaceRoot: '/other/teams' }, { stateRoot: '/other/state' }, { pid: -1 }, { app: 'other' }]) {
    await assert.rejects(projectHealth(project, respond({ ...valid, ...change })), /未接管/);
  }
  assert.equal(await projectHealth(project, async () => { throw Object.assign(new Error('connect'), { cause: { code: 'ECONNREFUSED' } }); }), null);
  await assert.rejects(projectHealth(project, async () => { throw new Error('invalid response'); }), /invalid response/);
});
