import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type ICodeBinarySource = 'override' | 'official' | 'bundled' | 'missing';

export interface ICodeBinaryResolution {
  path: string;
  source: ICodeBinarySource;
  notes: string[];
}

export interface PlatformPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Official launchers, in the same order as iCode-teams: `icode` first, `chrys` as compatibility name. */
export function officialICodePaths(options: PlatformPathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local');
    return [join(local, 'chrys', 'bin', 'icode.exe'), join(local, 'chrys', 'bin', 'chrys.exe')];
  }
  return [join(home, '.local', 'bin', 'icode'), join(home, '.local', 'bin', 'chrys')];
}

/** Native user configuration root: Windows `%APPDATA%\chrys`, other platforms `~/.chrys`. */
export function nativeConfigRoot(options: PlatformPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (platform === 'win32') return join(env.APPDATA?.trim() || join(home, 'AppData', 'Roaming'), 'chrys');
  return join(home, '.chrys');
}

export function nativeSessionsRoot(options: PlatformPathOptions = {}): string {
  return join(nativeConfigRoot(options), 'sessions');
}

function inspect(path: string) {
  try {
    const info = statSync(path);
    return { exists: true, file: info.isFile(), uid: info.uid };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, file: false, uid: undefined };
    throw error;
  }
}

function usable(path: string, platform: NodeJS.Platform, notes: string[]) {
  let info: ReturnType<typeof inspect>;
  try { info = inspect(path); }
  catch (error) {
    notes.push(`无法检查候选路径 ${path}：${(error as Error).message}`);
    return false;
  }
  if (!info.exists) return false;
  if (!info.file) {
    notes.push(`候选路径不是文件：${path}`);
    return false;
  }
  const uid = platform === 'win32' ? undefined : process.getuid?.();
  if (uid !== undefined && info.uid !== undefined && info.uid !== uid) {
    notes.push(`候选文件属于另一个系统用户：${path}`);
    return false;
  }
  return true;
}

/**
 * Resolve the iCode launcher without asking the user to configure anything.
 * Explicit override wins; otherwise use the documented official launcher path,
 * then the repository's development-only bundle. PATH is deliberately not scanned:
 * a random `icode` on PATH may be a different installation or a wrapper.
 */
export function resolveICodeBinary(options: PlatformPathOptions & { materialRoot?: string } = {}): ICodeBinaryResolution {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const notes: string[] = [];
  const override = env.DEMO_ICODE_BINARY?.trim();
  if (override) {
    if (!isAbsolute(override)) notes.push('DEMO_ICODE_BINARY 不是绝对路径，已按当前工作目录解析');
    const path = resolve(override);
    if (!usable(path, platform, notes)) notes.push(`显式配置的 iCode 不存在或不可用：${path}`);
    return { path, source: 'override', notes };
  }

  const official = officialICodePaths({ platform, env, home });
  for (const candidate of official) {
    if (usable(candidate, platform, notes)) return { path: candidate, source: 'official', notes };
  }
  notes.push(`官方安装位置未找到可用的 iCode：${official.join(' 与 ')}`);

  if (options.materialRoot) {
    const bundled = join(options.materialRoot, 'runtime', 'icode-0.31.0', platform === 'win32' ? 'icode.exe' : 'icode');
    if (usable(bundled, platform, notes)) {
      notes.push('使用仓库内开发包路径；该路径不是普通用户的安装位置');
      return { path: bundled, source: 'bundled', notes };
    }
  }

  return { path: official[0]!, source: 'missing', notes };
}
