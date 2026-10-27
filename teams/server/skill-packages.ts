import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import inventory from '../fixtures/skill-inventory.json';
import { projectSkillIds, resourcePublicationHistory, resourceSubscriptions, type SkillCatalogEntry } from '../src/resource-sharing.js';
import type { DemoState, Role } from '../src/domain.js';
import { DomainError } from '../src/domain.js';
import { workspace, runtimeDir } from './config.js';
import { atomicJson } from './store.js';
import { sha256, skillPackageDigest, validateSkillPackage, type NativeSkillPackage, type SkillPackageFile } from './skill-installation.js';
import { projectSkillVersions } from './shared-data.js';

function item(id: string) {
  const found=inventory.find(skill=>skill.name===id);
  if(!found) throw new DomainError('Skill 不在已登记的资源目录：'+id,404);
  return found;
}
async function files(root:string,prefix=''):Promise<SkillPackageFile[]> {
  const result:SkillPackageFile[]=[];
  for(const name of (await readdir(join(root,prefix))).sort()) {
    // Python bytecode is generated locally and is not part of a published Skill source package.
    if(name==='__pycache__'||/\.py[co]$/.test(name))continue;
    const path=prefix?prefix+'/'+name:name,absolute=join(root,path),stat=await lstat(absolute);
    if(stat.isSymbolicLink())throw new Error('Skill 来源包包含符号链接：'+path);
    if(stat.isDirectory())result.push(...await files(root,path));
    else if(stat.isFile()){const bytes=await readFile(absolute);result.push({path,sha256:sha256(bytes),executable:!!(stat.mode&0o111),bytes});}
    else throw new Error('Skill 来源包含非普通文件：'+path);
  }
  return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function loadSourceSkillPackage(id:string,sourceDirectory=join(workspace,'.agents','skills')):Promise<NativeSkillPackage> {
  const metadata=item(id),path=join(sourceDirectory,id),stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Skill 来源必须是实际目录：'+id);
  const entries=await files(path),body=entries.find(file=>file.path==='SKILL.md')?.bytes.toString('utf8');
  if(!body)throw new Error('Skill 正文缺失：'+id);
  const declared=body.match(/^\|\s*version\s*\|\s*([^|\s]+)\s*\|/m)?.[1]??body.match(/^version:\s*["']?([^\s"']+)/m)?.[1];
  if(declared!==metadata.version)throw new Error(`Skill 元数据与正文版本不一致：${id} (${metadata.version} / ${declared??'未声明'})`);
  const pkg={id,name:id,version:metadata.version,sha256:skillPackageDigest(entries),files:entries};validateSkillPackage(pkg);return pkg;
}
/** A project skill as the project uses it now: the source package with the files of the latest version Talents wrote for the project. */
export async function currentProjectSkillPackage(projectId:string,id:string):Promise<NativeSkillPackage> {
  const pkg=await loadSourceSkillPackage(id),written=(await projectSkillVersions(projectId)).find(version=>version.skillId===id);
  if(!written)return pkg;
  const files=new Map(pkg.files.map(file=>[file.path,file]));
  for(const file of written.files)if(file.content!==null){const bytes=Buffer.from(file.content);files.set(file.path,{path:file.path,sha256:sha256(bytes),executable:files.get(file.path)?.executable??false,bytes});}
  const list=[...files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const result={...pkg,version:written.version,sha256:skillPackageDigest(list),files:list};validateSkillPackage(result);return result;
}
function entry(pkg:NativeSkillPackage):SkillCatalogEntry {
  const metadata=item(pkg.id),owner=projectSkillIds.includes(pkg.id);
  return {id:pkg.id,name:pkg.name,description:metadata.description,version:pkg.version,sha256:pkg.sha256,contentSha256:pkg.files.find(file=>file.path==='SKILL.md')!.sha256,category:'skill',publisher:owner?'owner':'library',publisherName:owner?'林悦':'研发效能团队',source:'workspace/.agents/skills/'+pkg.id};
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
