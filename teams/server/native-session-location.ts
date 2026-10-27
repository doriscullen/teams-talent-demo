import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { DomainError } from '../src/domain.js';

export interface NativeSessionLocationMigration {
  runId: string;
  projectId: string;
  taskId: string;
  nodeId: string;
  sessionId: string;
  previousSessionRoot: string;
  sessionRoot: string;
  ownerSha256: string;
  manifestSha256: string;
}
export const nativeSessionMigrationFile = 'native-session-location-migrations.json';
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const invalid = () => new DomainError('原生会话目录迁移凭据无效或与原记录不匹配', 409);

/** An explicit operator-approved relocation receipt, never a search of former runtime paths.
 * Original manifest, owner and session bytes remain unchanged. Only the current fixed run directory is read. */
export async function nativeSessionRootMatches(runtimeRoot: string, runRoot: string, owner: Record<string, any>, declaredRuntime = runtimeRoot): Promise<boolean> {
  const current = join(runRoot, 'session-root');
  if (owner.sessionRoot === current) return true;
  if (owner.sessionRoot === resolve(declaredRuntime, 'work-contexts', owner.runId + '.native', 'session-root') && await realpath(declaredRuntime) === runtimeRoot) return true;
  const file = join(runtimeRoot, nativeSessionMigrationFile);
  let actual: string;
  try { actual = await realpath(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (actual !== file || !(await stat(file)).isFile() || (await stat(file)).size > 1024 * 1024) throw invalid();
  let receipt: { version: number; entries: NativeSessionLocationMigration[] };
  try { receipt = JSON.parse(await readFile(file, 'utf8')); } catch { throw invalid(); }
  if (receipt.version !== 1 || !Array.isArray(receipt.entries) || receipt.entries.length > 1000) throw invalid();
  const candidates = receipt.entries.filter(entry => entry?.runId === owner.runId);
  if (!candidates.length) return false;
  if (candidates.length !== 1) throw invalid();
  const entry = candidates[0];
  if (runRoot !== resolve(runtimeRoot, 'work-contexts', owner.runId + '.native') || entry.sessionRoot !== current ||
      !isAbsolute(entry.previousSessionRoot) || resolve(entry.previousSessionRoot) !== entry.previousSessionRoot || entry.previousSessionRoot !== owner.sessionRoot ||
      ['projectId', 'taskId', 'nodeId', 'sessionId'].some(key => entry[key as keyof NativeSessionLocationMigration] !== owner[key]) ||
      !/^[a-f0-9]{64}$/.test(entry.ownerSha256) || !/^[a-f0-9]{64}$/.test(entry.manifestSha256)) throw invalid();
  const ownerPath = join(runRoot, 'native-session.json'), manifestPath = join(runRoot, 'manifest.json');
  if (await realpath(ownerPath) !== ownerPath || await realpath(manifestPath) !== manifestPath) throw invalid();
  const [ownerBytes, manifestBytes] = await Promise.all([readFile(ownerPath), readFile(manifestPath)]);
  if (sha(ownerBytes) !== entry.ownerSha256 || sha(manifestBytes) !== entry.manifestSha256) throw invalid();
  let manifest: Record<string, any>;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw invalid(); }
  if (manifest.runId !== owner.runId || ['projectId', 'taskId', 'nodeId'].some(key => manifest.scope?.[key] !== owner[key])) throw invalid();
  return true;
}
