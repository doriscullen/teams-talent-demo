import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, win32 } from 'node:path';
import { createTerminalLauncher, findExecutable, formatShellCommand, launchEnvironment, windowsArgument, type TerminalRuntime } from '../server/terminal-launcher.js';

const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const executable = "C:\\工具 O'Brien & $ %;\\icode.exe";
const input = { executable, directory: "C:\\项目 空格 O'Brien & $ %;\\工作", args: ['', '中文 空格', "O'Brien", '&', '$', '%PATH%', ';', '`', 'embedded"quote', 'quote"tail\\'], instruction: '请读取上下文，未自动采用。' };
const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');
function setup(env: NodeJS.ProcessEnv = {}, platform: NodeJS.Platform = 'win32') {
  const calls: { file: string; args: string[]; options: unknown }[] = [], resolved: string[] = [];
  let failure: Error | undefined, stdout = '4321\n';
  const runtime: TerminalRuntime = { platform, env, macTerminals: async () => [{id:'terminal',name:'Terminal',path:'/System/Applications/Utilities/Terminal.app'},{id:'ghostty',name:'Ghostty',path:'/Applications/Ghostty.app'}], resolveExecutable: async name => { resolved.push(name); if (name === input.executable || name === '/tools/icode') return name; if (name === 'pwsh.exe') return null; if (name === 'powershell.exe') return shell; if (name === 'wt.exe') return 'C:\\Windows\\wt.exe'; return null; }, execute: async (file,args,options) => { calls.push({file,args,options}); if (failure) throw failure; return { stdout }; } };
  return { runtime, calls, resolved, launcher: createTerminalLauncher(runtime), fail: () => { failure = new Error('process launch denied'); }, reply: (value: string) => { stdout = value; } };
}
test('Windows independent launch creates one new console with encoded data and returns its PID', async () => {
  const t = setup({ DEMO_WINDOWS_TERMINAL: 'none' });
  const receipt = await t.launcher.launch(input);
  assert.equal(receipt.terminal, 'PowerShell'); assert.equal(receipt.pid, 4321); assert.equal(t.calls.length, 1);
  const call = t.calls[0]; assert.equal(call.file, shell); assert.deepEqual(call.args.slice(0,3), ['-NoProfile','-NonInteractive','-EncodedCommand']);
  const controller = decode(call.args[3]);
  assert.match(controller, /Start-Process .* -WindowStyle Normal -PassThru -ErrorAction Stop/);
  assert.doesNotMatch(controller, /NoNewWindow|RedirectStandard|ExecutionPolicy|cmd\.exe/i);
  const encoded = controller.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]; assert.ok(encoded);
  const payload = decode(encoded); assert.equal(payload, receipt.command);
  assert.match(payload, /Set-Location -LiteralPath 'C:\\项目 空格 O''Brien & \$ %;\\工作'/);
  assert.match(payload, /System.Diagnostics.ProcessStartInfo/); assert.match(payload, /\$start.UseShellExecute = \$false/);
  assert.doesNotMatch(payload, /RedirectStandard|^& \$|Invoke-Expression/m);
  assert.ok(payload.includes("$start.FileName = 'C:\\工具 O''Brien & $ %;\\icode.exe'"));
  assert.match(controller, /-NoExit/); assert.doesNotMatch(payload, /^exit /m);
  assert.match(receipt.note, /模型结果需在终端核对/);
});
test('Windows Terminal selection sends only encoded user data, preserves a GUID profile, and never emits cwd as a WT argument', async () => {
  const profile = '{12345678-1234-abcd-5678-1234567890ab}', t = setup({ WT_SESSION:'existing', WT_PROFILE_ID:profile });
  const receipt = await t.launcher.launch(input);
  assert.equal(receipt.terminal,'Windows Terminal'); assert.equal(t.calls.length,1);
  assert.deepEqual(t.calls[0].args.slice(0,7),['-w','0','nt','--profile',profile,'--title','Teams Agent']);
  assert.equal(decode(t.calls[0].args.at(-1)!),receipt.command);
  assert.equal(t.calls[0].args.some(arg=>arg.includes(';')),false);
  assert.equal(t.calls[0].args.includes('-d'),false); assert.equal(t.calls[0].args.includes(input.directory),false);
});
test('production route propagates process errors without a second terminal or a success receipt', async () => {
  for (const env of [{ DEMO_WINDOWS_TERMINAL:'none' },{ WT_SESSION:'existing' }]) {
    const t=setup(env); t.fail(); await assert.rejects(t.launcher.launch(input),/process launch denied/); assert.equal(t.calls.length,1);
  }
  const t=setup(); t.reply('unconfirmed'); await assert.rejects(t.launcher.launch(input),/待核对，未重复启动/); assert.equal(t.calls.length,1);
});
test('native-disabled and Linux reject before executable discovery or process creation', async () => {
  for (const [env,platform,reason] of [[{DEMO_NATIVE_DISABLED:'1'},'win32',/未开放/],[{},'linux',/仅支持 Windows 与 macOS/]] as const) {
    const t=setup(env,platform); await assert.rejects(t.launcher.launch(input),reason); assert.deepEqual(t.calls,[]); assert.deepEqual(t.resolved,[]);
  }
});
test('invalid WT profile and shell command separator reject before dispatch', async () => {
  for (const WT_PROFILE_ID of ['bad; nt cmd.exe','{12345678-1234-abcd-5678-1234567890ab']) {
    const t=setup({WT_SESSION:'existing',WT_PROFILE_ID}); await assert.rejects(t.launcher.launch(input),/GUID/); assert.equal(t.calls.length,0);
  }
  const t=setup({WT_SESSION:'existing',DEMO_POWERSHELL_BINARY:'C:\\PS;7\\pwsh.exe'});
  const resolve=t.runtime.resolveExecutable;t.runtime.resolveExecutable=async name=>name==='C:\\PS;7\\pwsh.exe'?name:resolve(name);
  await assert.rejects(createTerminalLauncher(t.runtime).launch(input),/DEMO_WINDOWS_TERMINAL=none/); assert.equal(t.calls.length,0);
});
test('explicit terminal configuration fails precisely and does not silently select another shell', async () => {
  const t=setup({DEMO_POWERSHELL_BINARY:'C:\\missing\\pwsh.exe'});await assert.rejects(t.launcher.launch(input),/DEMO_POWERSHELL_BINARY.*不存在/);assert.equal(t.calls.length,0);assert.equal(t.resolved.includes('powershell.exe'),false);
  const relative=setup({DEMO_POWERSHELL_BINARY:'pwsh.exe'});await assert.rejects(relative.launcher.launch(input),/绝对路径/);
  const wt=setup({WT_SESSION:'existing',DEMO_WINDOWS_TERMINAL:'C:\\missing\\wt.exe'});await assert.rejects(wt.launcher.launch(input),/DEMO_WINDOWS_TERMINAL.*不存在/);assert.equal(wt.calls.length,0);
});
test('Windows .cmd discovery is explicit and launch rejection gives the executable override', async () => {
  const found=await findExecutable('opencode','win32',{Path:'C:\\npm;C:\\bin'},async path=>path==='C:\\npm\\opencode.cmd'); assert.equal(found,'C:\\npm\\opencode.cmd');
  const t=setup();t.runtime.resolveExecutable=async()=>found;
  await assert.rejects(createTerminalLauncher(t.runtime).launch(input),/DEMO_OPENCODE_BINARY.*opencode.exe.*绝对路径/);assert.equal(t.calls.length,0);
});
test('executable resolution pins relative PATH entries before changing project cwd and does not hide access errors', async () => {
  assert.equal(await findExecutable('icode','darwin',{PATH:'relative-bin'},async()=>true),resolve('relative-bin/icode'));
  assert.equal(await findExecutable('icode','win32',{PATH:'relative-bin'},async()=>true),win32.resolve('relative-bin/icode.exe'));
  await assert.rejects(findExecutable('icode','darwin',{PATH:'/bin'},async()=>{throw Object.assign(new Error('access denied'),{code:'EACCES'});}),/access denied/);
});
test('Windows PATH discovery skips inaccessible app execution aliases but explicit paths still fail', async () => {
  const denied=async()=>{throw Object.assign(new Error('access denied'),{code:'EACCES'});};
  assert.equal(await findExecutable('wt.exe','win32',{Path:'C:\\WindowsApps'},denied),null);
  await assert.rejects(findExecutable('C:\\WindowsApps\\wt.exe','win32',{},denied),/access denied/);
});
test('macOS still uses one Terminal AppleScript with shell-quoted cwd, instruction, and argv', async () => {
  const t=setup({},'darwin'); const receipt=await t.launcher.launch({executable:'/tools/icode',directory:"/tmp/project O'Brien &;",args:['--agent','a b','--model',"x'y"],instruction:'read $context;'});
  assert.equal(receipt.terminal,'Terminal');assert.equal(t.calls.length,1);assert.equal(t.calls[0].file,'/usr/bin/osascript');assert.match(t.calls[0].args[1],/tell application "\/System\/Applications\/Utilities\/Terminal.app"/);
  assert.ok(receipt.command.includes("O'\\''Brien"));assert.ok(receipt.command.includes("'--model' 'x'\\''y'"));
  t.fail();await assert.rejects(t.launcher.launch({executable:'/tools/icode',directory:'/tmp',args:[]}),/process launch denied/);assert.equal(t.calls.length,2);
});
test('interactive launch removes non-interactive color suppression from the child environment', async () => {
  const env = launchEnvironment({ NO_COLOR: '1', TERM: 'dumb', CLICOLOR: '0', CLICOLOR_FORCE: '0', FORCE_COLOR: '0', PATH: 'C:\\bin' });
  assert.equal(env.NO_COLOR, undefined); assert.equal(env.CLICOLOR, undefined); assert.equal(env.CLICOLOR_FORCE, undefined);
  assert.equal(env.FORCE_COLOR, undefined); assert.equal(env.TERM, 'xterm-256color'); assert.equal(env.COLORTERM, 'truecolor'); assert.equal(env.PATH, 'C:\\bin');
  const t = setup({ DEMO_WINDOWS_TERMINAL: 'none', NO_COLOR: '1', TERM: 'dumb' });
  await t.launcher.launch(input);
  const launched = t.calls[0].options as { env: NodeJS.ProcessEnv };
  assert.equal(launched.env.NO_COLOR, undefined); assert.equal(launched.env.TERM, 'xterm-256color'); assert.equal(launched.env.COLORTERM, 'truecolor');
});
test('macOS cleans both osascript and the new terminal surface without changing a chosen theme or capable terminal', async () => {
  const { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  const inherited = { ...process.env, NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0', FORCE_COLOR: '0', TERM: 'xterm-ghostty', COLORTERM: 'truecolor', TEXTUAL_THEME: 'chosen-theme' };
  for (const terminal of ['terminal', 'ghostty']) {
    const t = setup(inherited, 'darwin');
    t.runtime.resolveExecutable = async name => name === process.execPath ? process.execPath : null;
    const receipt = await createTerminalLauncher(t.runtime).launch({ executable: process.execPath, directory: process.cwd(), terminal, args: ['-e', 'console.log(JSON.stringify(Object.fromEntries(["NO_COLOR","CLICOLOR","CLICOLOR_FORCE","FORCE_COLOR","TERM","COLORTERM","TEXTUAL_THEME"].map(k=>[k,process.env[k]??null]))))'] });
    const launch = t.calls[0].options as { env: NodeJS.ProcessEnv };
    assert.equal(launch.env.NO_COLOR, undefined); assert.equal(launch.env.TERM, 'xterm-ghostty');
    // Existing GUI processes can ignore osascript's environment. Execute the
    // actual surface command with the original dirty environment as regression.
    assert.match(receipt.command, /^unset NO_COLOR CLICOLOR CLICOLOR_FORCE;/);
    if (process.platform !== 'win32') {
      const { stdout } = await promisify(execFile)('/bin/sh', ['-c', receipt.command], { env: inherited });
      assert.deepEqual(JSON.parse(stdout), { NO_COLOR: null, CLICOLOR: null, CLICOLOR_FORCE: null, FORCE_COLOR: null, TERM: 'xterm-ghostty', COLORTERM: 'truecolor', TEXTUAL_THEME: 'chosen-theme' });
    }
  }
  assert.equal(inherited.NO_COLOR, '1');
  assert.equal(launchEnvironment({ FORCE_COLOR: '3', TERM: 'screen-256color', COLORTERM: '24bit', TEXTUAL_THEME: 'personal' }).FORCE_COLOR, '3');
});
test('argument quoting retains empty values, internal quotes, and trailing backslashes for CRT; probe mode can exit',async()=>{
  assert.equal(windowsArgument(''),'""');assert.equal(windowsArgument('a"b'),'"a\\"b"');assert.equal(windowsArgument('a\\'),'"a\\\\"');assert.equal(windowsArgument('a\\"b'),'"a\\\\\\"b"');
  const t=setup({DEMO_WINDOWS_TERMINAL:'none'}); const receipt=await t.launcher.launch({...input,keepOpen:false});assert.match(receipt.command,/^exit \$toolExit$/m);assert.doesNotMatch(decode(t.calls[0].args[3]),/-NoExit/);
  const cli=formatShellCommand(['C:\\node.exe','C:\\CLI O\'Brien\\teams-demo.mjs','--input-file','C:\\scope 空格.json'],'win32');assert.match(cli,/^& 'C:\\node.exe'/);assert.match(cli,/O''Brien/);assert.match(cli,/'--input-file'/);
});

test('Ghostty creates its own configured surface; unavailable or denied selection never falls back', async () => {
  const t=setup({},'darwin'), receipt=await t.launcher.launch({executable:'/tools/icode',directory:"/tmp/中文 O'Brien",args:['','"quoted"','$x;&'],terminal:'ghostty'});
  assert.equal(receipt.terminal,'Ghostty');assert.equal(t.calls.length,1);assert.match(t.calls[0].args[1],/Ghostty.app/);assert.match(t.calls[0].args[1],/new window with configuration cfg/);assert.doesNotMatch(t.calls[0].args[1],/input text|do script/);
  assert.equal(t.calls[0].args[3],"/tmp/中文 O'Brien");assert.ok(t.calls[0].args[2].startsWith('/bin/sh -c '));
  t.fail();await assert.rejects(t.launcher.launch({executable:'/tools/icode',directory:'/tmp',args:[],terminal:'ghostty'}),/process launch denied/);assert.equal(t.calls.length,2);
  t.runtime.macTerminals=async()=>[{id:'terminal',name:'Terminal',path:'/System/Applications/Utilities/Terminal.app'}];
  await assert.rejects(createTerminalLauncher(t.runtime).launch({executable:'/tools/icode',directory:'/tmp',args:[],terminal:'ghostty'}),/所选终端不可用.*未改用其他终端/);assert.equal(t.calls.length,2);
});

test('local terminal preference persists independently, rejects invalid/missing choices and changed confirmations', async () => {
  const {TerminalPreferences}=await import('../server/terminal-preferences.js');
  const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'terminal-preference-'));let options=[{id:'terminal',name:'Terminal'},{id:'ghostty',name:'Ghostty'}];
  try {
    const preferences=new TerminalPreferences(directory,'darwin',async()=>options);
    assert.equal((await preferences.context()).selectedTerminal,'terminal');await preferences.select('ghostty');
    assert.equal((await new TerminalPreferences(directory,'darwin',async()=>options).context()).selectedTerminal,'ghostty');assert.deepEqual(await preferences.selected('ghostty'),{id:'ghostty',name:'Ghostty'});
    await assert.rejects(preferences.selected('terminal'),/配置已变化/);await assert.rejects(preferences.select('other'),/不可用/);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'terminal-preference.json'),'utf8')),{terminal:'ghostty'});
    options=[options[0]];await assert.rejects(preferences.selected(),/所选终端不可用/);
    await writeFile(join(directory,'terminal-preference.json'),'invalid');await assert.rejects(preferences.selected(),/读取失败/);await preferences.select('terminal');assert.equal((await preferences.selected()).id,'terminal');
  } finally {await rm(directory,{recursive:true,force:true});}
});
