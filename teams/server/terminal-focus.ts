import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectWorkPlan } from '../src/project-work.js';
import { macTerminals } from './terminal-launcher.js';
const exec = promisify(execFile);
export async function focusWorkTerminal(history: NonNullable<ProjectWorkPlan['history']>, options: {
  platform?: NodeJS.Platform;
  execute?: (file: string, args: string[]) => Promise<{ stdout: string }>;
  terminals?: typeof macTerminals;
} = {}) {
  if (process.env.DEMO_NATIVE_DISABLED === '1') throw new Error('此验证实例未开放真实终端操作');
  const target = history.active?.terminal;
  if (!target || !history.active) throw new Error('未取得此会话的精确终端位置，请在原终端继续；未重复启动');
  if ((options.platform ?? process.platform) !== 'darwin') throw new Error('当前系统未提供此会话的精确窗口定位，请在原终端继续；未重复启动');
  const selected = (await (options.terminals ?? macTerminals)()).find(item => item.id === target.kind);
  if (!selected?.path) throw new Error('原会话终端已不可用，未改用其他终端');
  const application = '"' + selected.path.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
  const script = target.kind === 'ghostty'
    ? `on run argv\ntell application ${application}\nset matches to every terminal whose id is (item 1 of argv)\nif (count of matches) is not 1 then error "原会话终端已关闭或不能唯一定位"\nfocus (item 1 of matches)\nreturn "focused"\nend tell\nend run`
    : `on run argv\ntell application ${application}\nset matchCount to 0\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is (item 1 of argv) then\nset matchCount to matchCount + 1\nset targetWindow to w\nset targetTab to t\nend if\nend repeat\nend repeat\nif matchCount is not 1 then error "原会话终端已关闭或不能唯一定位"\nset selected tab of targetWindow to targetTab\nset index of targetWindow to 1\nactivate\nreturn "focused"\nend tell\nend run`;
  const execute = options.execute ?? (async (file, args) => { const value = await exec(file, args, { timeout: 10000, maxBuffer: 65536 }); return { stdout: value.stdout }; });
  const reply = await execute('/usr/bin/osascript', ['-e', script, target.id]);
  if (reply.stdout.trim() !== 'focused') throw new Error('终端没有确认切换成功；未重复启动');
  return { status: 'terminal-focused', note: `已切换到当前任务的 ${selected.name} 会话；未新建会话或向终端输入内容。` };
}
