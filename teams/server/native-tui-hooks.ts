import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { atomicText } from './store.js';

/** Add only our process-scoped native hooks; keep every existing hook and setting. */
export async function ensureNativeTuiHooks(script: string, backupDirectory: string, configDirectory = process.platform === 'win32' ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'chrys') : join(homedir(), '.chrys'), previousScript?: string) {
  const directory = join(configDirectory, 'hooks');
  let path = join(directory, 'hooks.json'), original: string | null = null;
  for (const name of ['hooks.yaml', 'hooks.yml', 'hooks.json']) {
    try { original = await readFile(join(directory, name), 'utf8'); path = join(directory, name); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const document = parseDocument(original ?? 'version: 1\nhooks: []\n');
  if (document.errors.length) throw new Error('iCode Hooks 配置无法解析，未修改原配置');
  const value = document.toJS();
  if (value?.version !== 1 || !Array.isArray(value.hooks)) throw new Error('iCode Hooks 配置结构无效，未修改原配置');
  const definitions = ['session_start', 'user_prompt_submit'].map(event => ({
    id: 'teams-scoped-tui-' + event.replaceAll('_', '-'), event, enabled: true,
    description: 'Teams scoped interactive work context; inactive without TEAMS_TUI_MANIFEST',
    run: { type: 'command', argv: [process.execPath, script] },
    execution: { mode: 'blocking', timeout_seconds: 10, on_error: event === 'user_prompt_submit' ? 'block' : 'warn' },
  }));
  let changed = false;
  for (const definition of definitions) {
    const existing = value.hooks.filter((hook: {id:string}) => hook?.id === definition.id);
    const prior = existing[0];
    const migrated = existing.length === 1 && prior && previousScript && prior.run?.argv?.length === 2 && prior.run.argv[0] === process.execPath && prior.run?.argv?.[1] === previousScript && JSON.stringify({...prior, run: {...prior.run, argv: [process.execPath, script]}}) === JSON.stringify(definition);
    if (migrated) { document.setIn(['hooks', value.hooks.indexOf(prior)], definition); changed = true; }
    if (!migrated && (existing.length > 1 || existing.length === 1 && JSON.stringify(existing[0]) !== JSON.stringify(definition))) throw new Error('Teams TUI Hook 与已有同名配置不同，请核对后再启动；未覆盖配置');
    if (!existing.length) { document.addIn(['hooks'], definition); changed = true; }
  }
  if (!changed) return { path, changed: false };
  await mkdir(directory, { recursive: true });
  if (original !== null) {
    await mkdir(backupDirectory, { recursive: true });
    const backup = join(backupDirectory, createHash('sha256').update(original).digest('hex') + '.yaml');
    try { await writeFile(backup, original, { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (await readFile(path, 'utf8') !== original) throw new Error('iCode Hooks 配置已被其他进程修改，未覆盖');
  }
  const content = path.endsWith('.json') ? JSON.stringify(document.toJS(), null, 2) + '\n' : document.toString();
  await atomicText(path, content);
  return { path, changed: true };
}
