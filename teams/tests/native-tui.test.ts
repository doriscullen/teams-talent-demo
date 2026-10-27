import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { ensureNativeTuiHooks } from '../server/native-tui-hooks.js';
const exec = promisify(execFile), hook = resolve('scripts/native/tui-work-hook.mjs');

test('scoped TUI hooks preserve existing configuration, back it up, remain idempotent and refuse collisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tui-hooks-')), config = join(directory, 'config'), backups = join(directory, 'backups');
  const original = '# existing manager rules\nversion: 1\nsettings:\n  max_parallel_hooks: 4\nhooks:\n  - id: existing-gate\n    event: user_prompt_submit\n    run: {type: command, argv: [unchanged-gate]}\n';
  try {
    await mkdir(join(config, 'hooks'), { recursive: true }); const path = join(config, 'hooks/hooks.yaml'); await writeFile(path, original);
    const result = await ensureNativeTuiHooks(hook, backups, config); assert.equal(result.changed, true);
    const after = await readFile(path, 'utf8'), parsed = parse(after); assert.match(after, /existing manager rules/); assert.deepEqual(parsed.hooks[0], parse(original).hooks[0]); assert.deepEqual(parsed.settings, parse(original).settings); assert.equal(parsed.hooks.length, 3);
    assert.equal(await readFile(join(backups, createHash('sha256').update(original).digest('hex') + '.yaml'), 'utf8'), original);
    assert.equal((await ensureNativeTuiHooks(hook, backups, config)).changed, false); assert.equal(await readFile(path, 'utf8'), after);
    await assert.rejects(ensureNativeTuiHooks('/unrelated/hook.mjs', backups, config), /同名配置不同/); assert.equal(await readFile(path, 'utf8'), after);
    const relocated=join(directory,'teams/scripts/native/tui-work-hook.mjs');assert.equal((await ensureNativeTuiHooks(relocated,backups,config,hook)).changed,true);const moved=parse(await readFile(path,'utf8'));assert.deepEqual(moved.hooks[0],parsed.hooks[0]);assert.deepEqual(moved.settings,parsed.settings);assert.deepEqual(moved.hooks.slice(1).map((item:any)=>item.run.argv),[[process.execPath,relocated],[process.execPath,relocated]]);assert.equal(await readFile(join(backups,createHash('sha256').update(after).digest('hex')+'.yaml'),'utf8'),after);assert.equal((await ensureNativeTuiHooks(relocated,backups,config,hook)).changed,false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native TUI Hook is inert outside Teams; scoped prompt gets exact context reminder and no business action', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tui-hook-event-'))), runId = randomUUID(), sessionId = randomUUID(), taskFile = join(directory, 'task.md'), manifestPath = join(directory, 'manifest.json'), resultPath = join(directory, 'hook-result.json'), payloadPath = join(directory, 'hook-payload.json');
  try {
    await exec(process.execPath, [hook], { env: { ...process.env, TEAMS_TUI_MANIFEST: '' } });
    const task = 'Exact Teams entry, role owner, current node develop'; await writeFile(taskFile, task);
    const scope = { projectId: 'carddemo', taskId: 'MKT-TUI-001', nodeId: 'develop' };
    await writeFile(manifestPath, JSON.stringify({ version: 1, executionMode: 'interactive', runId, scope, directory, taskFile, taskSha256: createHash('sha256').update(task).digest('hex') }));
    const env = { ...process.env, TEAMS_TUI_MANIFEST: manifestPath, CHRYS_HOOK_PAYLOAD_FILE: payloadPath, CHRYS_HOOK_RESULT: resultPath };
    const payload = { event: 'session_start', session_id: sessionId, cwd: directory };
    await writeFile(payloadPath, JSON.stringify(payload)); await exec(process.execPath, [hook], { env }); assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), { action: 'allow' });
    await writeFile(payloadPath, JSON.stringify({ ...payload, event: 'user_prompt_submit', text: 'Developer chooses to begin this node' })); await exec(process.execPath, [hook], { env });
    const injected = JSON.parse(await readFile(resultPath, 'utf8')); assert.equal(injected.action, 'allow'); assert.match(injected.system_reminder, /initial launch node develop/); assert.match(injected.system_reminder, /do not automatically advance/); assert.match(injected.system_reminder, /not a permanent node binding/); assert.match(injected.system_reminder, /fresh context.*nodeId/); assert.match(injected.system_reminder, /Wait until that node/); assert.ok(injected.system_reminder.includes(taskFile));
    const receipt = JSON.parse(await readFile(join(directory, 'tui-context-injected.json'), 'utf8')); assert.equal(receipt.sessionId, sessionId); assert.equal(receipt.runId, runId); assert.equal(receipt.status, 'reminder-returned');
    assert.equal(receipt.reminderMode, 'initial');
    await exec(process.execPath, [hook], { env });
    const continued = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(continued.action, 'allow');assert.ok(continued.system_reminder.length < injected.system_reminder.length * 0.75);assert.ok(!continued.system_reminder.includes(taskFile));assert.match(continued.system_reminder,/reuse actually read unchanged inputs/);assert.match(continued.system_reminder,/node\/version refresh/);assert.match(continued.system_reminder,/proves no reading, adoption/);
    assert.equal(JSON.parse(await readFile(join(directory,'tui-context-injected.json'),'utf8')).reminderMode,'continuation');
    // A newly opened TUI has its own run locator, even when restoring the same native session.
    const resumedDirectory=join(directory,'resumed');await mkdir(resumedDirectory);const resumedRun=randomUUID(),resumedManifest=join(resumedDirectory,'manifest.json');
    await writeFile(resumedManifest,JSON.stringify({version:1,executionMode:'interactive',runId:resumedRun,scope:{...scope,nodeId:'verify'},directory,taskFile,taskSha256:createHash('sha256').update(task).digest('hex')}));
    await exec(process.execPath,[hook],{env:{...env,TEAMS_TUI_MANIFEST:resumedManifest}});const resumed=JSON.parse(await readFile(resultPath,'utf8'));assert.match(resumed.system_reminder,/initial launch node verify/);assert.ok(resumed.system_reminder.includes(taskFile));assert.equal(JSON.parse(await readFile(join(resumedDirectory,'tui-context-injected.json'),'utf8')).reminderMode,'initial');
    await writeFile(join(directory,'tui-context-injected.json'),'{bad');await assert.rejects(exec(process.execPath,[hook],{env}),/Hook 失败/);await writeFile(join(directory,'tui-context-injected.json'),JSON.stringify(receipt));
    await writeFile(payloadPath, JSON.stringify({ ...payload, session_id: randomUUID() })); await assert.rejects(exec(process.execPath, [hook], { env }), /different native session/);
    await writeFile(payloadPath, JSON.stringify(payload)); await writeFile(taskFile, 'changed'); await assert.rejects(exec(process.execPath, [hook], { env }), /changed after confirmation/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('interactive wrapper refuses pipe/NUL transport before creating a runtime or launching an executable', async () => {
  await assert.rejects(exec(process.execPath, [resolve('scripts/native/run-project-tui.mjs'), '/nonexistent/manifest.json']), /stdin\/stdout\/stderr 均需 TTY/);
});
