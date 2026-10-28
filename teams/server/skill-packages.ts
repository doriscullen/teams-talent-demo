import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import inventory from '../fixtures/skill-inventory.json';
import sourceFiles from '../fixtures/skill-source-files.json';
import { projectSkillIds, resourcePublicationHistory, resourceSubscriptions, type SkillCatalogEntry } from '../src/resource-sharing.js';
import type { DemoState, Role } from '../src/domain.js';
import { DomainError } from '../src/domain.js';
import { workspace, runtimeDir } from './config.js';
import { atomicJson } from './store.js';
import { sha256, skillPackageDigest, validateSkillPackage, portableSkillPath, type NativeSkillPackage, type SkillPackageFile } from './skill-installation.js';

export interface SkillSourceFiles {
  version: number;
  sourceRoot: string;
  packages: Record<string, { files: Array<{ path: string; executable: boolean; sha256: string }> }>;
}
const sourceMaintenance = '；如为有意更新，请先更新 Skill 版本并将源文件加入 Git 索引，再从仓库根目录运行 node teams/scripts/generate-skill-source-manifest.mjs，核对后显式发布新版本（不修改历史 provenance）';
function declaredFiles(id: string, declaration: SkillSourceFiles) {
  const entries = declaration.packages?.[id]?.files;
  if (declaration.version !== 1 || declaration.sourceRoot !== 'workspace/skills' || !Array.isArray(entries) || !entries.length || entries.length > 1024) throw new Error('Skill 源包文件声明缺失或无效：' + id + sourceMaintenance);
  const names = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !portableSkillPath(entry.path) || names.has(entry.path.toLowerCase()) || typeof entry.executable !== 'boolean' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Skill 源包文件声明无效：' + id);
    names.add(entry.path.toLowerCase());
  }
  return new Map(entries.map(entry => [entry.path, entry]));
}

function item(id: string) {
  const found=inventory.find(skill=>skill.name===id);
  if(!found) throw new DomainError('Skill 不在已登记的资源目录：'+id,404);
  return found;
}
async function files(root:string,declared:ReturnType<typeof declaredFiles>,prefix=''):Promise<SkillPackageFile[]> {
  const result:SkillPackageFile[]=[];
  for(const name of (await readdir(join(root,prefix))).sort()) {
    // Python bytecode is generated locally and is not part of a published Skill source package.
    if(name==='__pycache__'||/\.py[co]$/.test(name))continue;
    const path=prefix?prefix+'/'+name:name,absolute=join(root,path),stat=await lstat(absolute);
    if(stat.isSymbolicLink())throw new Error('Skill 来源包包含符号链接：'+path);
    if(stat.isDirectory())result.push(...await files(root,declared,path));
    else if(stat.isFile()){
      const entry=declared.get(path);if(!entry)throw new Error('Skill 来源包含未声明文件：'+path+sourceMaintenance);
      const bytes=await readFile(absolute),digest=sha256(bytes);
      if(digest!==entry.sha256)throw new Error('Skill 源文件内容与声明摘要不一致：'+path+sourceMaintenance);
      result.push({path,sha256:digest,executable:entry.executable,bytes});
    }
    else throw new Error('Skill 来源包含非普通文件：'+path);
  }
  return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function loadSourceSkillPackage(id:string,sourceDirectory=join(workspace,'skills'),declaration:SkillSourceFiles=sourceFiles):Promise<NativeSkillPackage> {
  const metadata=item(id),path=join(sourceDirectory,id),stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Skill 来源必须是实际目录：'+id);
  // Source-package identity uses committed Git modes, never host chmod or ZIP modes.
  // Explicit test/source directories must satisfy the same declared file/byte set.
  const declared=declaredFiles(id,declaration),entries=await files(path,declared);
  if(entries.length!==declared.size)throw new Error('Skill 来源缺少已声明文件：'+id+sourceMaintenance);
  const body=entries.find(file=>file.path==='SKILL.md')?.bytes.toString('utf8');
  if(!body)throw new Error('Skill 正文缺失：'+id);
  const declaredVersion=body.match(/^\|\s*version\s*\|\s*([^|\s]+)\s*\|/m)?.[1]??body.match(/^version:\s*["']?([^\s"']+)/m)?.[1];
  if(declaredVersion!==metadata.version)throw new Error(`Skill 元数据与正文版本不一致：${id} (${metadata.version} / ${declaredVersion??'未声明'})`);
  const pkg={id,name:id,version:metadata.version,sha256:skillPackageDigest(entries),files:entries};validateSkillPackage(pkg);return pkg;
}
function entry(pkg:NativeSkillPackage):SkillCatalogEntry {
  const metadata=item(pkg.id),owner=projectSkillIds.includes(pkg.id);
  return {id:pkg.id,name:pkg.name,description:metadata.description,version:pkg.version,sha256:pkg.sha256,contentSha256:pkg.files.find(file=>file.path==='SKILL.md')!.sha256,category:'skill',publisher:owner?'owner':'library',publisherName:owner?'林悦':'研发效能团队',source:'workspace/skills/'+pkg.id};
}
export async function readSkillCatalog() {
  const packages=await Promise.all(inventory.map(skill=>loadSourceSkillPackage(skill.name)));
  return {skillCatalog:packages.map(entry),skillContents:Object.fromEntries(packages.map(pkg=>[pkg.id,pkg.files.find(file=>file.path==='SKILL.md')!.bytes.toString('utf8')]))};
}
interface StoredPackage extends Omit<NativeSkillPackage,'files'> { files:Array<Omit<SkillPackageFile,'bytes'>&{base64:string}> }
async function readPackage(path:string):Promise<NativeSkillPackage> {
  const stored=JSON.parse(await readFile(path,'utf8')) as StoredPackage;
  if(!Array.isArray(stored.files))throw new Error('固定 Skill 内容包清单损坏');
  const pkg={...stored,files:stored.files.map(({base64,...file})=>({...file,bytes:Buffer.from(base64,'base64')}))};validateSkillPackage(pkg);return pkg;
}
/** Called only by explicit publication, never by bootstrap or service startup. */
export async function publicationCatalog():Promise<SkillCatalogEntry[]> {
  const result:SkillCatalogEntry[]=[];
  for(const metadata of inventory){
    const pkg=await loadSourceSkillPackage(metadata.name),path=join(runtimeDir,'skill-packages',pkg.sha256+'.json');
    try {const prior=await readPackage(path);if(prior.id!==pkg.id||prior.version!==pkg.version||prior.sha256!==pkg.sha256)throw new Error('固定 Skill 内容包身份冲突');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await atomicJson(path,{...pkg,files:pkg.files.map(({bytes,...file})=>({...file,base64:bytes.toString('base64')}))});}
    result.push(entry(pkg));
  }
  return result;
}
export async function loadNativeSkillPackage(id:string,version:string,digest:string):Promise<NativeSkillPackage> {
  item(id);if(!/^[a-f0-9]{64}$/.test(digest))throw new DomainError('Skill 包摘要无效');
  let pkg:NativeSkillPackage;
  try{pkg=await readPackage(join(runtimeDir,'skill-packages',digest+'.json'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new DomainError('固定版本内容包不存在；请重新发布核实的资源版本',404);throw error;}
  if(pkg.id!==id||pkg.version!==version||pkg.sha256!==digest)throw new DomainError('请求版本与固定 Skill 内容包不匹配');return pkg;
}
export async function getPublishedSkillPackage(state:DemoState,role:Role,id:string,version:string,digest:string) {
  const subscription=resourceSubscriptions(state,role).find(record=>record.id===id);
  if(!subscription||!subscription.sha256||subscription.version!==version||subscription.sha256!==digest)throw new DomainError('当前用户尚未订阅该 Skill 的固定版本',403);
  if(!resourcePublicationHistory(state).some(record=>record.id===id&&record.version===version&&record.sha256===digest))throw new DomainError('订阅对应的发布版本不存在',409);
  return loadNativeSkillPackage(id,version,digest);
}
