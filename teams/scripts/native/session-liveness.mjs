// Read-only process identity check shared by the server and the TUI resume wrapper.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function inspectNativeProcess(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('原生会话 PID 无效');
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return null; throw error; }
  if (platform === 'win32') {
    const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){@{startedAt=$p.CreationDate.ToUniversalTime().ToString('o');state='running'}|ConvertTo-Json -Compress}`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 5000, windowsHide: true });
    return stdout.trim() ? JSON.parse(stdout) : null;
  }
  try {
    const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'stat='], { timeout: 5000, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    const match = stdout.trim().match(/^(.*?)\s+([A-Za-z+<NsELslWIXZ?]+)$/);
    if (!match) throw new Error('无法核验原生会话进程创建时间');
    const time = Date.parse(match[1]); if (!Number.isFinite(time)) throw new Error('原生会话进程创建时间无效');
    return { startedAt: new Date(time).toISOString(), state: match[2] };
  } catch (error) { if (error.code === 1 && !String(error.stdout ?? '').trim()) return null; throw error; }
}
export async function nativeProcessActive(owner, processRecord, inspect = inspectNativeProcess) {
  const observed = await inspect(owner.pid);
  if (!observed || observed.state.startsWith('Z')) return false;
  const started = Date.parse(observed.startedAt), acquired = Date.parse(owner.startedAt), spawned = Date.parse(processRecord?.startedAt ?? owner.startedAt);
  if (![started, acquired, spawned].every(Number.isFinite)) throw new Error('原生会话进程时间不能核验');
  // ps timestamps have one-second precision. A later process with a reused PID
  // is not the original native owner, even if an old lock file remains.
  if (started > acquired + 1000) return false;
  if (processRecord && processRecord.pid !== owner.pid || started < spawned - 2000) throw new Error('原生会话 PID 已不匹配原启动记录，未猜测其归属');
  return true;
}
