#!/usr/bin/env node
// Observe an actual iCode run. This launcher never calls a Teams business API.
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, realpath, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { copyPreparedSession } from './run-project-tui.mjs';
import { nativeTraceEnvironment, checkNativeTraceReceiver, traceLaunchEnvironment } from './tui-trace.mjs';
import { loopbackProxyEnvironment } from './native-environment.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp', handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
async function executeProjectTask(manifestPath, lifecycle) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const directory = await realpath(manifest.directory), output = await realpath(dirname(manifestPath));
  if (manifest.version !== 1 || !/^[0-9a-f-]{36}$/i.test(manifest.runId) || !isAbsolute(manifest.executable) || !isAbsolute(manifest.taskFile) || !manifest.agent || !manifest.model || directory !== manifest.directory) throw new Error('Native task manifest is invalid');
  await access(manifest.executable, constants.X_OK);
  if (digest(await readFile(manifest.taskFile)) !== manifest.taskSha256) throw new Error('Task prompt changed after confirmation; native run was not started');
  const trace = manifest.trace ? nativeTraceEnvironment(traceLaunchEnvironment(process.env,manifest.trace),{...manifest.scope,runId:manifest.runId},manifest.trace.endpoint) : null;
  if(trace?.enabled){
    if(manifest.trace.runtime){const r=manifest.trace.runtime,check=JSON.parse((await promisify(execFile)(r.python,['-I',r.script],{timeout:15000,maxBuffer:65536,windowsHide:true})).stdout);if(!check.ready||check.sdkVersion!==r.sdkVersion||check.exporterVersion!==r.exporterVersion)throw new Error('iCode OTLP运行依赖已变化');}
    await checkNativeTraceReceiver(trace.endpoint,manifest.trace);
  }
  const sentinel = await open(join(output, 'started.json'), 'wx', 0o600);
  const startedAt = new Date().toISOString();
  try { await sentinel.writeFile(JSON.stringify({ runId: manifest.runId, startedAt })); await sentinel.sync(); } finally { await sentinel.close(); }
  const sessionRoot = join(output, 'session-root');
  if(manifest.preparedSession)await copyPreparedSession(manifest,output);else await mkdir(sessionRoot);
  const args = ['run', '--task', manifest.taskFile, '--agent', manifest.agent, '--model', manifest.model, '-C', directory, ...(manifest.preparedSession?['--session',manifest.preparedSession.sessionId]:[]), '--json'];
  const stdout = createWriteStream(join(output, 'stdout.json'), { flags: 'wx', mode: 0o600 });
  const stderr = createWriteStream(join(output, 'stderr.log'), { flags: 'wx', mode: 0o600 });
  let outputText = '', session, observerError, done = false;
  lifecycle.spawnAttempted = true;
  const child = spawn(manifest.executable, args, { cwd: directory, env: { ...loopbackProxyEnvironment(trace?.env ?? process.env), CHRYS_SESSION_ROOT_DIR: sessionRoot, TEAMS_TUI_MANIFEST: '' }, windowsHide:true, stdio: ['ignore', 'pipe', 'pipe'] });
  const finished = new Promise(resolve => { child.once('error', error => resolve({ code: null, signal: null, error: error.message })); child.once('close', (code, signal) => resolve({ code, signal })); });
  await atomicJson(join(output, 'process.json'), { runId: manifest.runId, executable: manifest.executable, args, directory, pid: child.pid ?? null, startedAt, sessionRoot, ...(manifest.executionMode?{executionMode:manifest.executionMode}: {}) });
  child.stdout.on('data', bytes => { outputText += bytes.toString('utf8'); stdout.write(bytes); process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { stderr.write(bytes); process.stderr.write(bytes); });
  const observe = (async () => {
    const locks = join(sessionRoot, 'sessions', '.locks');
    while (!done && !session) {
      let names;
      try { names = await readdir(locks); } catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
      const owners = await Promise.all(names.filter(name => name.endsWith('.active.json')).map(async name => JSON.parse(await readFile(join(locks, name), 'utf8'))));
      if (owners.length > 1) throw new Error('Multiple native sessions observed in this task run');
      if (owners.length === 1) {
        const owner = owners[0];
        if (!/^[0-9a-f-]{36}$/i.test(owner.session_id) || manifest.preparedSession&&owner.session_id!==manifest.preparedSession.sessionId || !Number.isSafeInteger(owner.pid) || owner.pid < 2 || Date.parse(owner.started_at) < Date.parse(startedAt) - 1000) throw new Error('Invalid native session ownership record');
        process.kill(owner.pid, 0);
        session = { runId: manifest.runId, ...manifest.scope, sessionId: owner.session_id, pid: owner.pid, startedAt: owner.started_at, source: 'icode-active-session-owner', sessionRoot, ...(manifest.executionMode?{executionMode:manifest.executionMode}: {}) };
        await atomicJson(join(output, 'native-session.json'), session);
      } else await new Promise(resolve => setTimeout(resolve, 100));
    }
  })().catch(error => { observerError = error.message; });
  const result = await finished;
  done = true; await observe;
  await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))]);
  let response;
  if (result.code === 0) {
    try { response = JSON.parse(outputText); } catch { observerError ??= 'iCode did not return a valid JSON result'; }
    if (!session || response?.session_id !== session.sessionId) observerError ??= 'iCode result and observed session ID do not match';
  }
  const receipt = { ...(manifest.executionMode?{executionMode:manifest.executionMode}: {}), runId: manifest.runId, ...manifest.scope, startedAt, finishedAt: new Date().toISOString(), nativeExitCode: result.code, signal: result.signal, sessionId: session?.sessionId ?? null, pid: session?.pid ?? child.pid ?? null, status: result.code === 0 && !observerError ? 'completed' : 'failed', error: result.error ?? observerError ?? (result.code ? 'iCode exited unsuccessfully' : null), stdoutPath: join(output, 'stdout.json'), stderrPath: join(output, 'stderr.log') };
  await atomicJson(join(output, 'result.json'), receipt);
  return receipt;
}

export async function runProjectTask(manifestPath) {
  const lifecycle={spawnAttempted:false};
  try{return await executeProjectTask(manifestPath,lifecycle);}catch(error){error.nativeLaunchState=lifecycle.spawnAttempted?'spawn-attempted':'not-spawned';throw error;}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runProjectTask(process.argv[2]); process.exitCode = result.status === 'completed' ? 0 : result.nativeExitCode || 1; }
  catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); try{const manifest=JSON.parse(await readFile(process.argv[2],'utf8')),output=dirname(await realpath(process.argv[2]));await atomicJson(join(output,'launch-error.json'),{runId:manifest.runId,...manifest.scope,error:error.message,nativeLaunchState:error.nativeLaunchState,at:new Date().toISOString()});}catch(recordError){console.error('无法保存启动失败记录：'+recordError.message);} process.exitCode = 1; }
}
