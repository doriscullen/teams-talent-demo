/** Windows selection/encoding follows chrys-manager chrys_launcher.py:284–388
 * (361b4f218098de1b44625cf9c56f18b64993b5f7). Independent consoles use PowerShell Start-Process
 * instead of cmd/start; ProcessStartInfo bypasses PS 5.1 argv binding.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve, win32 } from 'node:path';
import { homedir } from 'node:os';
import { interactiveEnvironment, interactiveShellSetup } from '../scripts/native/interactive-environment.mjs';
const exec = promisify(execFile);
export interface TerminalInput { executable: string; directory: string; args: string[]; instruction?: string; keepOpen?: boolean; terminal?: string }
export interface TerminalOption { id: string; name: string; path?: string }
export async function macTerminals(directories = ['/System/Applications/Utilities', '/Applications', join(homedir(), 'Applications')]): Promise<TerminalOption[]> {
  const found: TerminalOption[] = [];
  for (const [id, name] of [['terminal', 'Terminal'], ['ghostty', 'Ghostty']]) for (const directory of directories) {
    const path = join(directory, name + '.app');
    try { if ((await stat(path)).isDirectory()) { found.push({ id, name, path }); break; } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return found;
}
export interface TerminalRuntime {
  platform: NodeJS.Platform; env: NodeJS.ProcessEnv;
  macTerminals(): Promise<TerminalOption[]>;
  resolveExecutable(name: string): Promise<string | null>;
  execute(file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string } | void>;
}
export interface TerminalReceipt { status: 'terminal-requested'; terminal: 'Windows Terminal' | 'PowerShell' | 'Terminal' | 'Ghostty'; pid?: number; terminalId?: string; command: string; note: string }
export const posixQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const powershellQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function formatShellCommand(args: string[], platform: NodeJS.Platform = process.platform) {
  return (platform === 'win32' ? '& ' : '') + args.map(platform === 'win32' ? powershellQuote : posixQuote).join(' ');
}
/**
 * Interactive terminals must not inherit the host agent's non-interactive color
 * suppression (`NO_COLOR=1`, `TERM=dumb`). Keep the user's terminal profile, but
 * make the launched TUI advertise a color-capable terminal.
 */
export function launchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return interactiveEnvironment(env);
}
/** CommandLineToArgv/CRT inverse: quote every argv element, including empty values. */
export function windowsArgument(value: string) {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
export function powershellPayload(input: TerminalInput) {
  return ["$ErrorActionPreference = 'Stop'", `Set-Location -LiteralPath ${powershellQuote(input.directory)}`,
    ...(input.instruction ? [`Write-Host ${powershellQuote(input.instruction)}`] : []),
    '$start = New-Object System.Diagnostics.ProcessStartInfo', `$start.FileName = ${powershellQuote(input.executable)}`,
    `$start.WorkingDirectory = ${powershellQuote(input.directory)}`, '$start.UseShellExecute = $false',
    `$start.Arguments = ${powershellQuote(input.args.map(windowsArgument).join(' '))}`,
    '$tool = [System.Diagnostics.Process]::Start($start)', "if ($null -eq $tool) { throw 'Tool process was not started' }",
    '$tool.WaitForExit()', '$toolExit = $tool.ExitCode', '$tool.Dispose()',
    input.keepOpen === false ? 'exit $toolExit' : "if ($toolExit -ne 0) { Write-Host ('工具退出码：' + $toolExit) }",
  ].join('\n');
}
export async function findExecutable(name: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, canExecute = async (path: string) => {
  try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
}) {
  const paths = platform === 'win32' ? win32 : { isAbsolute, join, resolve };
  const explicit = paths.isAbsolute(name) || /[\\/]/.test(name);
  const names = platform === 'win32' && !/\.[a-z0-9]+$/i.test(name) ? [name + '.exe', name + '.cmd', name + '.bat'] : [name];
  const candidates = explicit ? names : (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean).flatMap(dir => names.map(file => paths.join(dir.replace(/^"|"$/g, ''), file)));
  for (const path of candidates) {
    try { if (await canExecute(path)) return paths.resolve(path); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows App Execution Aliases (for example wt.exe under WindowsApps) can
      // deny stat() while access(X_OK) succeeds. Treat them as absent during PATH
      // discovery; an explicitly configured path still reports the real error.
      if (!explicit && platform === 'win32' && (code === 'EACCES' || code === 'EPERM')) continue;
      throw error;
    }
  }
  return null;
}
export function createTerminalLauncher(overrides: Partial<TerminalRuntime> = {}) {
  const platform = overrides.platform ?? process.platform, env = overrides.env ?? process.env;
  const runtime: TerminalRuntime = { platform, env, macTerminals, resolveExecutable: name => findExecutable(name, platform, env), execute: async (file, args, options) => { const result = await exec(file, args, { ...options, timeout: 15000, maxBuffer: 65536, windowsHide: true }); return { stdout: result.stdout }; }, ...overrides };
  async function configured(key: string, names: string[]) {
    const explicit = runtime.env[key];
    if (explicit) {
      if (!(runtime.platform === 'win32' ? win32.isAbsolute(explicit) : isAbsolute(explicit))) throw new Error(key + ' 必须是绝对路径');
      const found = await runtime.resolveExecutable(explicit); if (!found) throw new Error(key + ' 指向的可执行文件不存在'); return found;
    }
    for (const name of names) { const found = await runtime.resolveExecutable(name); if (found) return found; }
    return null;
  }
  return { async terminals(): Promise<TerminalOption[]> {
    if (runtime.platform === 'darwin') return runtime.macTerminals();
    if (runtime.platform === 'win32') return [{ id: 'system', name: runtime.env.WT_SESSION && runtime.env.DEMO_WINDOWS_TERMINAL !== 'none' && await configured('DEMO_WINDOWS_TERMINAL', ['wt.exe']) ? 'Windows Terminal' : 'PowerShell' }];
    return [];
  }, async launch(input: TerminalInput): Promise<TerminalReceipt> {
    if (runtime.env.DEMO_NATIVE_DISABLED === '1') throw new Error('此验证实例未开放真实原生启动');
    if (!['darwin', 'win32'].includes(runtime.platform)) throw new Error('自动终端启动仅支持 Windows 与 macOS；请在当前系统手工启动工具');
    for (const value of [input.executable, input.directory, ...input.args, input.instruction ?? '']) if (typeof value !== 'string' || value.includes('\0')) throw new Error('终端参数包含无效字符');
    if (!(runtime.platform === 'win32' ? win32.isAbsolute(input.directory) : isAbsolute(input.directory))) throw new Error('工作目录必须是绝对路径');
    const executable = await runtime.resolveExecutable(input.executable); if (!executable) throw new Error('工具程序不存在：' + input.executable);
    if (runtime.platform === 'win32' && !/\.exe$/i.test(executable)) throw new Error('Windows 自动启动需要原生 .exe；不执行 .cmd/.bat 的二次 shell 解析。OpenCode 请设置 DEMO_OPENCODE_BINARY 为 opencode.exe 绝对路径，iCode 使用 DEMO_ICODE_BINARY。');
    if (runtime.platform === 'darwin') {
      const selected = (await runtime.macTerminals()).find(item => item.id === (input.terminal ?? 'terminal'));
      if (!selected?.path) throw new Error('所选终端不可用：' + (input.terminal ?? 'terminal') + '；请安装或在 Agent 管理中重新选择，未改用其他终端');
      const command = interactiveShellSetup + 'cd ' + posixQuote(input.directory) + ' && ' + (input.instruction ? 'printf ' + posixQuote('%s\n') + ' ' + posixQuote(input.instruction) + ' && ' : '') + formatShellCommand([executable, ...input.args], 'darwin');
      const application = '"' + selected.path.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
      // Create a new surface; never send a command to an existing user session.
      const script = selected.id === 'ghostty'
        ? 'on run argv\ntell application ' + application + '\nset cfg to new surface configuration\nset initial working directory of cfg to item 2 of argv\nset command of cfg to item 1 of argv\nset wait after command of cfg to ' + (input.keepOpen === false ? 'false' : 'true') + '\nset agentWindow to new window with configuration cfg\nactivate window agentWindow\nreturn id of (focused terminal of selected tab of agentWindow)\nend tell\nend run'
        : 'on run argv\ntell application ' + application + '\nactivate\nset agentTab to do script (item 1 of argv)\nreturn tty of agentTab\nend tell\nend run';
      const reply = await runtime.execute('/usr/bin/osascript', ['-e', script, selected.id === 'ghostty' ? '/bin/sh -c ' + posixQuote(command) : command, input.directory], { cwd: input.directory, env: launchEnvironment(runtime.env) });
      return { status: 'terminal-requested', terminal: selected.name as 'Terminal' | 'Ghostty', ...(reply?.stdout.trim() ? { terminalId: reply.stdout.trim() } : {}), command, note: '系统已受理 ' + selected.name + ' 启动请求；不代表模型执行或上下文已读取。' };
    }
    if (input.terminal && input.terminal !== 'system') throw new Error('所选终端不适用于 Windows，未启动其他终端');
    const launchEnv = launchEnvironment(runtime.env);
    const shell = await configured('DEMO_POWERSHELL_BINARY', ['pwsh.exe', 'powershell.exe', ...(runtime.env.SystemRoot ? [win32.join(runtime.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')] : [])]);
    if (!shell) throw new Error('未找到 PowerShell；请安装 PowerShell 7 或设置 DEMO_POWERSHELL_BINARY 为 powershell.exe / pwsh.exe 绝对路径');
    const command = powershellPayload({ ...input, executable }), encoded = Buffer.from(command, 'utf16le').toString('base64');
    const shellArgs = [...(input.keepOpen === false ? [] : ['-NoExit']), '-NoProfile', '-EncodedCommand', encoded];
    const wt = runtime.env.DEMO_WINDOWS_TERMINAL === 'none' ? null : await configured('DEMO_WINDOWS_TERMINAL', ['wt.exe']);
    if (runtime.env.WT_SESSION && wt) {
      const profile = runtime.env.WT_PROFILE_ID?.trim();
      if (profile && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.replace(/^\{(.*)\}$/, '$1'))) throw new Error('WT_PROFILE_ID 必须是有效 GUID，未发送终端请求');
      if (shell.includes(';')) throw new Error('PowerShell 路径含 Windows Terminal 命令分隔符；请设置 DEMO_WINDOWS_TERMINAL=none 使用独立控制台');
      // No user cwd/title/argv is exposed to WT's semicolon command parser.
      await runtime.execute(wt, ['-w', '0', 'nt', ...(profile ? ['--profile', profile] : []), '--title', 'Teams Agent', shell, ...shellArgs], { cwd: input.directory, env: launchEnv });
      return { status: 'terminal-requested', terminal: 'Windows Terminal', command, note: 'Windows Terminal 已受理新标签页请求；不代表工具已读取上下文或完成工作。' };
    }
    // Start-Process creates a fresh console with real standard handles; detached +
    // stdio:ignore would pass NUL to a TUI even if the process itself was started.
    const controller = ["$ErrorActionPreference = 'Stop'",
      `$terminal = Start-Process -FilePath ${powershellQuote(shell)} -ArgumentList ${powershellQuote(shellArgs.join(' '))} -WorkingDirectory ${powershellQuote(input.directory)} -WindowStyle Normal -PassThru -ErrorAction Stop`,
      '[Console]::WriteLine($terminal.Id)',
    ].join('\n');
    const reply = await runtime.execute(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(controller, 'utf16le').toString('base64')], { cwd: input.directory, env: launchEnv });
    const pidText = reply?.stdout.trim(), pid = Number(pidText);
    if (!pidText || !/^\d+$/.test(pidText) || !Number.isSafeInteger(pid) || pid < 2) throw new Error('PowerShell 终端请求未返回可核对的 PID；结果待核对，未重复启动');
    return { status: 'terminal-requested', terminal: 'PowerShell', pid, command, note: '系统已创建 PowerShell 终端进程；工具启动或模型结果需在终端核对。' };
  } };
}
