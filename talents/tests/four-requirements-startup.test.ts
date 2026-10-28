/** Production HTTP startup/export/selection with isolated state; native execution is disabled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialState, type DemoState } from '../../teams/src/domain.ts';
import { createDeliveryRequirement } from '../../teams/src/delivery-requirements.ts';
import { migrateMainDelivery } from '../../teams/server/delivery-migration.ts';
import type { TalentNodeInputs } from '../../teams/src/talent-node-inputs.ts';
import { registeredTaskSkill } from '../../teams/server/talent-intake.ts';
import { fourRequirementScenarios, fourRequirementScenariosV2, fourRequirementNodes } from '../../shared/four-requirement-scenarios.ts';
import { sharedPaths, type TalentsKnowledge } from '../../shared/contracts.ts';
import { seedState } from '../server/seed.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scenarios = [...fourRequirementScenarios, ...fourRequirementScenariosV2];
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

test('empty startup and reset publish all eight sources; Teams selects their real files and Skills without native work', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talents-startup-'));
  const teamsState = join(directory, 'teams'), talentState = join(directory, 'talents'), shared = join(directory, 'shared');
  const children: ChildProcess[] = []; let logs = '';
  const ports = new Set<number>(); while (ports.size < 3) ports.add(await freePort());
  const [teamsPort, talentPort, tracePort] = [...ports];
  const teamsOrigin = 'http://127.0.0.1:' + teamsPort, talentOrigin = 'http://127.0.0.1:' + talentPort;
  const configuration = join(directory, 'config.json'); await writeFile(configuration, '{}');
  const env = { ...process.env, DEMO_LOCAL_CONFIG: configuration, DEMO_PORT: String(teamsPort), DEMO_TALENT_PORT: String(talentPort), DEMO_TRACE_PORT: String(tracePort), DEMO_STATE_DIR: teamsState, DEMO_TALENT_STATE_DIR: talentState, DEMO_SHARED_DIR: shared, DEMO_SHARED_SEED_DIR: join(repository, 'shared/seed'), DEMO_TRACE_DATA_DIR: join(directory, 'trace'), DEMO_NATIVE_DISABLED: '1' };
  async function get<T>(origin: string, path: string): Promise<T> {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
  }
  async function start(name: 'teams' | 'talents', origin: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: join(repository, name), env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); child.stdout!.on('data', value => { logs += value; }); child.stderr!.on('data', value => { logs += value; });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(name + ' exited: ' + logs);
      try { if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) return child; } catch { /* startup polling only */ }
      await delay(50);
    }
    throw new Error('startup timeout: ' + logs);
  }
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
  try {
    // Fixtures are written only into the isolated store. No create/assign API, scheduler or model is invoked.
    const fixture = initialState(); migrateMainDelivery(fixture);
    const tasks = scenarios.map(s => createDeliveryRequirement(fixture, 'owner', { projectId: 'carddemo', id: 'REQ-' + randomUUID(), title: s.title, description: s.creationDescription, assigneeId: 'member' }, '2026-10-28T00:00:00Z'));
    const originals = structuredClone(tasks);
    await mkdir(teamsState, { recursive: true }); await writeFile(join(teamsState, 'state.json'), JSON.stringify(fixture));
    await start('teams', teamsOrigin);
    const seedKnowledge = await get<{ artifacts: TalentsKnowledge['artifacts'] }>(teamsOrigin, '/api/talents/knowledge?project=carddemo');
    for (const [index, scenario] of scenarios.entries()) {
      const artifact = seedKnowledge.artifacts.find(item => item.id === scenario.artifactId)!;
      assert.equal(artifact.version, scenario.version); assert.equal(artifact.files.length, 7);
      for (const file of artifact.files) {
        const query = new URLSearchParams({ artifact: artifact.id, version: String(artifact.version), path: file.path });
        const actual = await get<{ content: string; absolutePath: string }>(teamsOrigin, '/api/talents/file?' + query);
        assert.equal(actual.content, await readFile(join(repository, 'talents/content', file.path), 'utf8'));
        assert.equal(actual.absolutePath, join(repository, 'shared/seed', sharedPaths.talentsFile(artifact.id, artifact.version, file.path)));
      }
      const query = new URLSearchParams({ role: 'owner', projectId: 'carddemo', taskId: tasks[index].id, nodeId: 'prepare' });
      const input = await get<TalentNodeInputs>(teamsOrigin, '/api/task-node-inputs?' + query);
      assert.equal(input.selection.status, 'configured'); assert.equal(input.selection.scenario?.id, scenario.id);
      assert.deepEqual(input.skills.map(skill => skill.id), fourRequirementNodes.prepare.skills);
    }
    await assert.rejects(readFile(join(talentState, 'state.json')), { code: 'ENOENT' }, 'Teams alone must not initialize Talents state');
    const talents = await start('talents', talentOrigin);
    const boot = await get<{ state: ReturnType<typeof seedState> }>(talentOrigin, '/api/bootstrap');
    assert.deepEqual(boot.state.tasks, seedState().tasks, 'publishing sources must not create execution tasks');
    assert.deepEqual(boot.state.artifacts.filter(a => scenarios.some(s => s.artifactId === a.id)).map(a => a.id).sort(), scenarios.map(s => s.artifactId).sort());
    const beforePreview = await readFile(join(talentState, 'state.json'));
    const preview = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tools/register-four-requirements.ts', '--endpoint', talentOrigin, '--version', '2'], { cwd: join(repository, 'talents'), env });
    const description = JSON.parse(preview.stdout);
    assert.equal(description.mode, 'dry-run'); assert.deepEqual(description.wouldAdd, []);
    assert.deepEqual(description.scenarios.map((s: { title: string; creationDescription: string }) => [s.title, s.creationDescription]), fourRequirementScenariosV2.map(s => [s.title, s.creationDescription]));
    assert.deepEqual(await readFile(join(talentState, 'state.json')), beforePreview, 'documented copy/preview command must not write state');
    const published = JSON.parse(await readFile(join(shared, sharedPaths.talentsKnowledge), 'utf8')) as TalentsKnowledge;
    const knowledge = await get<{ artifacts: TalentsKnowledge['artifacts'] }>(teamsOrigin, '/api/talents/knowledge?project=carddemo');
    assert.deepEqual(knowledge.artifacts, published.artifacts.filter(a => a.projectId === 'carddemo'));
    let fileCount = 0, selectionCount = 0;
    for (const [index, scenario] of scenarios.entries()) {
      const artifact = knowledge.artifacts.find(a => a.id === scenario.artifactId)!;
      assert.equal(artifact.version, scenario.version); assert.equal(artifact.files.length, 7);
      const manifest = JSON.parse(await readFile(join(repository, 'talents/content', scenario.manifest), 'utf8'));
      for (const file of artifact.files) {
        const query = new URLSearchParams({ artifact: artifact.id, version: String(artifact.version), path: file.path });
        const actual = await get<{ content: string; absolutePath: string }>(teamsOrigin, '/api/talents/file?' + query);
        assert.equal(actual.content, await readFile(join(repository, 'talents/content', file.path), 'utf8'));
        assert.equal(actual.absolutePath, join(shared, sharedPaths.talentsFile(artifact.id, artifact.version, file.path)), 'must read the just-published copy, not a committed fallback');
        const expected = manifest.knowledgeFiles.find((entry: { path: string }) => entry.path === file.path);
        if (expected) assert.equal(digest(actual.content), expected.sha256);
        fileCount++;
      }
      for (const nodeId of ['prepare', 'develop', 'verify', 'accept'] as const) {
        const query = new URLSearchParams({ role: 'owner', projectId: 'carddemo', taskId: tasks[index].id, nodeId });
        const input = await get<TalentNodeInputs>(teamsOrigin, '/api/task-node-inputs?' + query);
        assert.equal(input.selection.status, 'configured'); assert.equal(input.selection.scenario?.id, scenario.id);
        assert.equal(input.selection.scenario?.artifactVersion, scenario.version);
        assert.deepEqual(input.skills.map(skill => skill.id), fourRequirementNodes[nodeId].skills);
        for (const skill of input.skills) assert.deepEqual(skill, await registeredTaskSkill(skill.id), 'selection must load the actual registered package');
        const reference = input.knowledge.assets.flatMap(asset => asset.references ?? []).find(ref => ref.path === scenario.files.requirement)!;
        assert.equal(reference.sha256, scenario.sourceSha256);
        assert.equal(digest(await readFile(reference.absolutePath!)), scenario.sourceSha256);
        selectionCount++;
      }
    }
    const state = await get<DemoState>(teamsOrigin, '/api/state');
    assert.deepEqual(state.workspace.deliveryRequirements!.filter(task => originals.some(original => original.id === task.id)), originals);
    assert.equal(state.workspace.collaboration, undefined);
    assert.ok(!(await readdir(teamsState)).includes('work-contexts'));
    // The ordinary reset endpoint uses the same complete seed and exporter.
    const response = await fetch(talentOrigin + '/api/reset', { method: 'POST', headers: { origin: talentOrigin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200, await response.clone().text());
    const afterReset = await get<{ state: ReturnType<typeof seedState> }>(talentOrigin, '/api/bootstrap');
    assert.deepEqual(afterReset.state.artifacts, seedState().artifacts);
    const resetExport = JSON.parse(await readFile(join(shared, sharedPaths.talentsKnowledge), 'utf8')) as TalentsKnowledge;
    assert.deepEqual(resetExport.artifacts, published.artifacts);
    // A normal restart preserves a valid existing state byte-for-byte, including its revision.
    await stop(talents); const saved = await readFile(join(talentState, 'state.json'));
    await start('talents', talentOrigin); assert.deepEqual(await readFile(join(talentState, 'state.json')), saved);
    assert.equal(fileCount, 56); assert.equal(selectionCount, 32);
    console.log('Verified Teams-first seed and fresh Talents startup/reset/restart: 8 sources, 56 files in each source path, 40 node selections; no model, adoption or task progress.');
  } finally {
    await Promise.all(children.map(stop)); await rm(directory, { recursive: true, force: true });
  }
});
