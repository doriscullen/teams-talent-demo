#!/usr/bin/env node
// Interactive launch: the child inherits the terminal, while observation only writes runtime receipts.
import { promisify } from 'node:util';
import { spawn, execFile } from 'node:child_process';
import { readFile, realpath, open, mkdir, readdir, rename, writeFile, cp } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { nativeTraceEnvironment, checkNativeTraceReceiver, traceLaunchEnvironment } from './tui-trace.mjs';
import { interactiveEnvironment } from './interactive-environment.mjs';
import { nativeProcessActive } from './session-liveness.mjs';
async function atomic(path, value) { const temp = path + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temp, path); }
export async function copyPreparedSession(manifest, output) {
  const prepared = manifest.preparedSession, uuid = /^[0-9a-f-]{36}$/i;
  if (!prepared || ![prepared.sessionId, prepared.sourceRunId, prepared.preparationRunId].every(value => uuid.test(value)) || prepared.sourceRunId === manifest.runId) throw new Error('待恢复准备会话标识无效');
  const source = join(dirname(output), prepared.sourceRunId + '.native');
  if (await realpath(source) !== source) throw new Error('准备会话运行目录不能被符号链接替换');
  const owner = JSON.parse(await readFile(join(source, 'native-session.json'), 'utf8'));
  const optional = async name => { try { return JSON.parse(await readFile(join(source,name),'utf8')); } catch(error) { if(error.code==='ENOENT')return null;throw error; } };
  const result = await optional('result.json'), processRecord = await optional('process.json');
  if (owner.runId !== prepared.sourceRunId || owner.sessionId !== prepared.sessionId || owner.projectId !== manifest.scope.projectId || owner.taskId !== manifest.scope.taskId || owner.sessionRoot !== join(source, 'session-root')) throw new Error('准备会话范围或结束回执不匹配');
  if (owner.executionMode === 'interactive') {
    if (result && (result.executionMode !== 'interactive' || result.runId !== prepared.sourceRunId || result.sessionId !== prepared.sessionId || !['completed','failed'].includes(result.status))) throw new Error('会话退出回执身份不匹配');
    if (await nativeProcessActive(owner, processRecord)) throw new Error('原会话仍在运行，请回到原终端；未重复启动');
  } else if (!result || result.runId !== prepared.sourceRunId || result.status !== 'completed' || result.sessionId !== prepared.sessionId) throw new Error('准备会话范围或结束回执不匹配');
  const shortId = prepared.sessionId.replaceAll('-', '').slice(0, 12), sourceDirectory = join(source, 'session-root', 'sessions', shortId);
  let active;
  try { active = JSON.parse(await readFile(join(source, 'session-root', 'sessions', '.locks', shortId + '.active.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (active) {
    if (active.session_id !== prepared.sessionId || active.pid !== owner.pid || active.started_at !== owner.startedAt) throw new Error('原会话活动锁身份不匹配');
    if (await nativeProcessActive(owner, processRecord)) throw new Error('原会话仍在运行，请回到原终端；未重复启动');
  }
  let latest;
  for (const file of ['session.json', 'session.recovery.json']) {
    let bytes;
    try { bytes = await readFile(join(sourceDirectory, file)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const value = JSON.parse(bytes.toString('utf8')), updatedAt = Date.parse(value.meta?.updated_at);
    if (value.meta?.session_id !== prepared.sessionId || !Number.isFinite(updatedAt)) throw new Error('准备会话正文身份或保存时间无效');
    if (!latest || updatedAt > latest.updatedAt) latest = { bytes, updatedAt };
  }
  if (!latest || createHash('sha256').update(latest.bytes).digest('hex') !== prepared.sessionSha256) throw new Error('准备会话正文在确认后变化，请重新读取计划');
  const verifyTree = async directory => { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('准备会话材料包含符号链接，未复制'); if (entry.isDirectory()) await verifyTree(join(directory, entry.name)); } };
  await verifyTree(sourceDirectory);
  await mkdir(join(output, 'session-root', 'sessions'), { recursive: true });
  await cp(sourceDirectory, join(output, 'session-root', 'sessions', shortId), { recursive: true, errorOnExist: true, force: false });
  // Original preparation evidence stays immutable; the native UUID is preserved
  // in this run's independent writable storage for normal TUI continuation.
  await atomic(join(output, 'prepared-session-copy.json'), { ...prepared, copiedAt: new Date().toISOString() });
}
export async function runProjectTui(manifestPath) {
  if (![process.stdin, process.stdout, process.stderr].every(stream => stream.isTTY)) throw new Error('交互式 iCode 必须在真实终端中运行（stdin/stdout/stderr 均需 TTY）');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), output = await realpath(dirname(manifestPath)), directory = await realpath(manifest.directory);
  if (manifest.version !== 1 || manifest.executionMode !== 'interactive' || !/^[0-9a-f-]{36}$/i.test(manifest.runId) || !isAbsolute(manifest.executable) || manifest.directory !== directory || createHash('sha256').update(await readFile(manifest.taskFile)).digest('hex') !== manifest.taskSha256) throw new Error('TUI 启动材料无效或已变化');
  const trace = nativeTraceEnvironment(traceLaunchEnvironment(process.env, manifest.trace), { ...manifest.scope, runId: manifest.runId }, manifest.trace?.endpoint);
  if (trace.enabled) {
    if (manifest.trace?.runtime) {
      const runtime=manifest.trace.runtime,check=JSON.parse((await promisify(execFile)(runtime.python,['-I',runtime.script],{timeout:15000,maxBuffer:65536})).stdout);
      if(check.ready!==true || check.sdkVersion!==runtime.sdkVersion || check.exporterVersion!==runtime.exporterVersion) throw new Error('iCode OTLP 运行依赖已变化，请重新核验启动配置');
    }
    await checkNativeTraceReceiver(trace.endpoint, manifest.trace);
  }
  const startedAt = new Date().toISOString(), sentinel = await open(join(output, 'started.json'), 'wx', 0o600);
  try { await sentinel.writeFile(JSON.stringify({ runId: manifest.runId, startedAt, executionMode: 'interactive' })); } finally { await sentinel.close(); }
  const sessionRoot = join(output, 'session-root');
  if(manifest.preparedSession)await copyPreparedSession(manifest,output);else await mkdir(sessionRoot);
  const args = ['-C', directory, '--agent', manifest.agent, '--model', manifest.model, ...(manifest.preparedSession ? ['--session', manifest.preparedSession.sessionId] : [])];
  const child = spawn(manifest.executable, args, { cwd: directory, env: { ...interactiveEnvironment(trace.env), CHRYS_SESSION_ROOT_DIR: sessionRoot, TEAMS_TUI_MANIFEST: manifestPath }, stdio: 'inherit' });
  const result = new Promise(resolve => { child.once('error', error => resolve({ code: null, error: error.message })); child.once('close', (code, signal) => resolve({ code, signal })); });
  await atomic(join(output, 'process.json'), { runId: manifest.runId, executable: manifest.executable, args, directory, pid: child.pid ?? null, startedAt, sessionRoot, executionMode: 'interactive', tty: { stdin: true, stdout: true, stderr: true }, trace: { endpoint: trace.endpoint, enabled: trace.enabled, sensitiveData: trace.sensitiveData } });
  let done = false, session, observerError;
  const observe = (async () => {
    while (!done && !session) {
      let names = [];
      try { names = await readdir(join(sessionRoot, 'sessions', '.locks')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const owners = await Promise.all(names.filter(name => name.endsWith('.active.json')).map(async name => JSON.parse(await readFile(join(sessionRoot, 'sessions', '.locks', name), 'utf8'))));
      if (owners.length > 1) throw new Error('当前作业出现多个原生会话，未猜测关联');
      if (owners.length === 1) {
        const owner = owners[0];
        if (!/^[0-9a-f-]{36}$/i.test(owner.session_id) || manifest.preparedSession && owner.session_id !== manifest.preparedSession.sessionId || !Number.isSafeInteger(owner.pid) || owner.pid < 2 || Date.parse(owner.started_at) < Date.parse(startedAt) - 1000) throw new Error('原生 TUI 会话身份无效');
        process.kill(owner.pid, 0);
        session = { runId: manifest.runId, ...manifest.scope, sessionId: owner.session_id, pid: owner.pid, startedAt: owner.started_at, source: 'icode-active-session-owner', sessionRoot, executionMode: 'interactive' };
        await atomic(join(output, 'native-session.json'), session);
      } else await new Promise(resolve => setTimeout(resolve, 100));
    }
  })().catch(error => { observerError = error.message; });
  // Raw-mode TUI handles keyboard input itself. Terminal-close signals are forwarded only to this child.
  const forward = signal => { if (!done) child.kill(signal); };
  const onTerm = () => forward('SIGTERM'), onHup = () => forward('SIGHUP');
  process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
  const ended = await result; done = true; await observe;
  process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup);
  const receipt = { runId: manifest.runId, ...manifest.scope, startedAt, finishedAt: new Date().toISOString(), nativeExitCode: ended.code, signal: ended.signal ?? null, sessionId: session?.sessionId ?? null, pid: session?.pid ?? child.pid ?? null, status: ended.code === 0 && session && !observerError ? 'completed' : 'failed', error: ended.error ?? observerError ?? (!session ? 'TUI 已退出，但尚未建立可核验会话' : ended.code ? 'TUI 进程异常退出' : null), executionMode: 'interactive', note: '此记录只表示交互式会话退出，不表示任务节点完成或验收。' };
  await atomic(join(output, 'result.json'), receipt); return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runProjectTui(process.argv[2]); console.log(result.status === 'completed' ? 'iCode 交互会话已结束；任务状态以 Teams 回传为准。' : 'iCode 交互会话未正常结束：' + result.error); process.exitCode = result.status === 'completed' ? 0 : result.nativeExitCode || 1; }
  catch (error) { console.error('无法启动交互式 iCode：' + error.message); process.exitCode = 1; }
}
