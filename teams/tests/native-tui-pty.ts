// POSIX PTY transport verification; the executable below is a probe, never a model.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const exec = promisify(execFile);
if (process.platform === 'win32') { console.log('SKIP POSIX PTY probe; Windows requires its native console probe'); process.exit(0); }
const directory = await realpath(await mkdtemp(join(tmpdir(), 'teams-tui-pty-'))), output = join(directory, 'run'), executable = join(directory, 'probe'), taskFile = join(directory, 'task.md'), runId = randomUUID(), sessionId = randomUUID(), text = 'Current node only; transport probe';
try {
  await mkdir(output); await writeFile(taskFile, text);
  await writeFile(executable, `#!/usr/bin/env node
const {mkdir,writeFile}=require('node:fs/promises'),{join}=require('node:path');
(async()=>{const root=process.env.CHRYS_SESSION_ROOT_DIR,id=${JSON.stringify(sessionId)},short=id.replaceAll('-','').slice(0,12),info={args:process.argv.slice(2),cwd:process.cwd(),tty:[process.stdin.isTTY,process.stdout.isTTY,process.stderr.isTTY],contextLocator:!!process.env.TEAMS_TUI_MANIFEST,proxy:Object.fromEntries(['NO_PROXY','no_proxy','HTTP_PROXY','HTTPS_PROXY'].map(key=>[key,process.env[key]]))};await mkdir(join(root,'sessions','.locks'),{recursive:true});await writeFile(join(root,'sessions','.locks',short+'.active.json'),JSON.stringify({session_id:id,pid:process.pid,started_at:new Date().toISOString()}));await writeFile(join(root,'probe.json'),JSON.stringify(info));process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('TUI_PROBE_READY');let input='';process.stdin.on('data',async bytes=>{input+=bytes.toString();if(input.includes('typed-not-submitted')){info.typed=true;await writeFile(join(root,'probe.json'),JSON.stringify(info));process.stdout.write('TUI_PROBE_INPUT_VISIBLE');}if(input.includes('q'))process.exit(0);});})().catch(e=>{console.error(e);process.exitCode=1});
`); await chmod(executable, 0o755);
  const manifest = { version: 1, executionMode: 'interactive', runId, scope: { projectId: 'carddemo', taskId: 'MKT-TUI-PROBE', nodeId: 'develop' }, executable, directory, agent: 'Code', model: 'probe', taskFile, taskSha256: createHash('sha256').update(text).digest('hex') };
  const path = join(output, 'manifest.json'); await writeFile(path, JSON.stringify(manifest));
  const python = `import os,pty,subprocess,select,time,json,sys\nmaster,slave=pty.openpty()\np=subprocess.Popen(sys.argv[1:],stdin=slave,stdout=slave,stderr=slave,start_new_session=True)\nos.close(slave)\nseen=b'';typed=False;quit=False;deadline=time.monotonic()+12\nwhile time.monotonic()<deadline and p.poll() is None:\n r,_,_=select.select([master],[],[],0.1)\n if r:\n  try:seen+=os.read(master,65536)\n  except OSError:break\n if b'TUI_PROBE_READY' in seen and not typed:\n  time.sleep(0.3);os.write(master,b'typed-not-submitted');typed=True\n if b'TUI_PROBE_INPUT_VISIBLE' in seen and not quit:\n  os.write(master,b'q');quit=True\nif p.poll() is None:\n p.terminate();p.wait(timeout=5);raise Exception('PTY probe timed out')\nprint(json.dumps({'exit':p.returncode,'typed':typed,'visible':b'TUI_PROBE_INPUT_VISIBLE' in seen}))\nos.close(master)\n`;
  const reply = await exec('python3', ['-c', python, process.execPath, resolve('scripts/native/run-project-tui.mjs'), path], { timeout: 20000, env: { ...process.env, CHRYS_OTEL: 'false', NO_PROXY: 'example.internal', no_proxy: 'lower.internal', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' } });
  const result = JSON.parse(reply.stdout); assert.deepEqual(result, { exit: 0, typed: true, visible: true });
  const probe = JSON.parse(await readFile(join(output, 'session-root/probe.json'), 'utf8')), receipt = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
  assert.deepEqual(probe.tty, [true, true, true]); assert.equal(probe.cwd, directory); assert.equal(probe.typed, true); assert.equal(probe.contextLocator, true); assert.deepEqual(probe.args, ['-C', directory, '--agent', 'Code', '--model', 'probe']); assert.equal(receipt.sessionId, sessionId); assert.equal(receipt.status, 'completed');
  assert.deepEqual(probe.proxy, { NO_PROXY: 'example.internal,lower.internal,127.0.0.1,localhost,::1,[::1]', no_proxy: 'example.internal,lower.internal,127.0.0.1,localhost,::1,[::1]', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' });
  await mkdir('test-results/native-tui', { recursive: true }); await writeFile('test-results/native-tui/pty-result.json', JSON.stringify({ passed: true, nativeModelExecuted: false, transport: 'actual POSIX PTY and production wrapper', ...result, probe, receipt }, null, 2));
  console.log('PASS production TUI wrapper preserves interactive stdin/stdout/stderr and observes native-owned session');
} finally { await rm(directory, { recursive: true, force: true }); }
