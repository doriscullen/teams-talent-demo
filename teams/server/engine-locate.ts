import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { nativeConfigRoot, nativeSessionsRoot, resolveICodeBinary, type PlatformPathOptions } from './icode-binary.js';
import { nativePlatformEnvironment } from './native-skill-reader.js';

const exec = promisify(execFile);

/** Same read-only shape as iCode-teams' `chrys.engine.locate` response. */
export interface ChrysEngineLocation {
  state: 'ready' | 'none' | 'failed';
  entry?: string;
  version?: string;
  environment?: Record<string, string>;
  config?: string;
  sessionRoot?: string;
  reason?: string;
  notes?: string[];
}

export interface LocateEngineOptions extends PlatformPathOptions {
  materialRoot: string;
  probe?: (entry: string) => Promise<string>;
  environment?: () => Promise<{ configDirectory: string; sessionRoot?: string }>;
}

async function isFile(path: string) {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function defaultProbe(entry: string) {
  return (await exec(entry, ['--version'], { timeout: 15000, maxBuffer: 65536, windowsHide: true })).stdout.trim();
}

/**
 * Read-only engine location. It never changes the selected installation or triggers
 * install/upgrade. A missing explicit override is a failure (never silently fall back);
 * a missing official launcher is `none`; a probe failure is still `failed`.
 */
export async function locateChrysEngine(options: LocateEngineOptions): Promise<{ engine: ChrysEngineLocation }> {
  const resolution = resolveICodeBinary(options);
  const notes = [...resolution.notes];
  let entry = resolution.path;
  try {
    if (!await isFile(entry)) {
      return { engine: resolution.source === 'override'
        ? { state: 'failed', entry, reason: `显式配置的 iCode 不存在或不是文件：${entry}`, notes }
        : { state: 'none', reason: `未找到可用的 iCode：${entry}`, notes } };
    }
  } catch (error) {
    return { engine: { state: 'failed', entry, reason: `无法检查 iCode 路径：${(error as Error).message}`, notes } };
  }

  let version: string;
  try {
    version = (await (options.probe ?? defaultProbe)(entry)).trim();
    if (!version) throw new Error('版本输出为空');
  } catch (error) {
    return { engine: { state: 'failed', entry, reason: `iCode 版本探测失败：${(error as Error).message}`, notes } };
  }

  let config = nativeConfigRoot(options);
  let sessionRoot = nativeSessionsRoot(options);
  try {
    const environment = await (options.environment ?? nativePlatformEnvironment)();
    config = environment.configDirectory;
    sessionRoot = environment.sessionRoot ?? join(config, 'sessions');
  } catch (error) {
    notes.push('无法读取 iCode 原生配置目录，使用平台默认位置：' + (error as Error).message);
  }

  return { engine: { state: 'ready', entry, version, config, sessionRoot, notes } };
}
