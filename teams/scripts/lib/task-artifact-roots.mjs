import { open, readFile, realpath, lstat, rename, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname, parse } from 'node:path';
import { randomUUID } from 'node:crypto';

export const artifactRootsFilename = 'task-artifact-roots.json';
// Deliberately lexical plus realpath checks: local registrars must pass an existing canonical directory.
export async function canonicalDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) throw new Error('资料目录必须为规范绝对路径');
  if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error('资料目录不可为符号链接或非目录');
  let at = path;
  while (at !== parse(at).root) { if ((await lstat(at)).isSymbolicLink()) throw new Error('资料目录不允许符号链接'); at = dirname(at); }
  return path;
}
export function contained(root, path) { const part = relative(root, path); return !!part && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part); }
function validate(value) {
  if (value?.version !== 1 || !Array.isArray(value.roots)) throw new Error('任务资料目录登记表损坏');
  const seen = new Set();
  for (const row of value.roots) {
    if (!row || typeof row.projectId !== 'string' || !row.projectId || typeof row.taskId !== 'string' || !row.taskId || typeof row.directory !== 'string' || !isAbsolute(row.directory) || typeof row.registeredAt !== 'string' || !Number.isFinite(Date.parse(row.registeredAt)) || (row.nativeRunId !== undefined && !/^[a-f\d-]{36}$/i.test(row.nativeRunId))) throw new Error('任务资料目录登记字段无效');
    const key = JSON.stringify([row.projectId,row.taskId,row.directory]); if (seen.has(key)) throw new Error('任务资料目录登记重复'); seen.add(key);
    for (const other of value.roots) if (row !== other && (row.projectId !== other.projectId || row.taskId !== other.taskId) && (row.directory === other.directory || contained(row.directory,other.directory) || contained(other.directory,row.directory))) throw new Error('不同任务的资料目录不可重叠');
  }
  return value;
}
export async function readTaskArtifactRoots({runtime,teamsRoot,projectId,taskId}) {
  await canonicalDirectory(runtime);
  const path = join(runtime,artifactRootsFilename);let bytes;
  try { const stat=await lstat(path);if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024*1024) throw new Error('任务资料目录登记表不是有效普通文件'); bytes=await readFile(path,'utf8'); }
  catch (error) { if (error.code==='ENOENT') return []; throw error; }
  const table=validate(JSON.parse(bytes));const rows=table.roots.filter(row=>row.projectId===projectId && row.taskId===taskId);
  for (const row of rows) {
    await canonicalDirectory(row.directory);
    if (!contained(join(teamsRoot,'test-results'),row.directory) && !contained(join(runtime,'task-artifacts'),row.directory)) throw new Error('已登记资料目录超出本机产物范围');
  }
  return rows;
}
/** Local maintenance API only. No HTTP route may invoke this registrar. */
export async function registerTaskArtifactRoot(options) {
  const { runtime,teamsRoot,projectId,taskId,directory,nativeRunId }=options;
  await canonicalDirectory(runtime);await canonicalDirectory(teamsRoot);await canonicalDirectory(directory);
  if (!contained(join(teamsRoot,'test-results'),directory) && !contained(join(runtime,'task-artifacts'),directory)) throw new Error('资料目录必须是 test-results 或 task-artifacts 中的任务专属子目录');
  const path=join(runtime,artifactRootsFilename),lock=await open(path+'.lock','wx',0o600);let temp;
  try {
    let table;try {const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('任务资料目录登记表无效');table=validate(JSON.parse(await readFile(path,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;table={version:1,roots:[]};}
    const existing=table.roots.find(row=>row.projectId===projectId&&row.taskId===taskId&&row.directory===directory);
    if(existing)return existing;
    const row={projectId,taskId,directory,registeredAt:new Date().toISOString(),...(nativeRunId?{nativeRunId}:{})};table.roots.push(row);validate(table);
    temp=path+'.'+randomUUID()+'.tmp';const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(table,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temp,path);temp=undefined;return row;
  } finally { if(temp)await unlink(temp);await lock.close();await unlink(path+'.lock'); }
}
