import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { binary, root, runtimeDir } from './config.js';
import { atomicJson } from './store.js';
import { readUnchangedSkillPackage, type NativeSkillPackage } from './skill-installation.js';
import type { SkillApplicationReceipt } from '../src/skill-application.js';
const exec = promisify(execFile);
const script = join(root,'scripts/native/read-installed-skill.py');
async function executable(path:string){try{await access(path,constants.X_OK);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
export interface NativePlatformEnvironment { python: string; version: string; configDirectory: string; sessionRoot: string; }
let platformEnvironment: Promise<NativePlatformEnvironment> | undefined;
/** Resolve the installed iCode runtime, its platform config root and its session root. */
export function nativePlatformEnvironment(): Promise<NativePlatformEnvironment> {
  if (!platformEnvironment) platformEnvironment = resolveNativePlatformEnvironment().catch(error => { platformEnvironment = undefined; throw error; });
  return platformEnvironment;
}
async function resolveNativePlatformEnvironment(): Promise<NativePlatformEnvironment> {
  const version=(await exec(binary,['--version'],{timeout:15000,maxBuffer:65536,windowsHide:true})).stdout.trim();
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('iCode 未返回有效原生版本');
  let python=process.env.DEMO_ICODE_PYTHON;
  if(python){if(!isAbsolute(python)||!await executable(python))throw new Error('DEMO_ICODE_PYTHON 必须指向当前 iCode 安装的 Python 可执行绝对路径');}
  else {
    const cache=process.platform==='darwin'?join(homedir(),'Library/Application Support/pyapp/chrys'):process.platform==='win32'&&process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'pyapp','data','chrys'):join(process.env.XDG_DATA_HOME??join(homedir(),'.local','share'),'pyapp','chrys');
    const candidates:string[]=[];
    if(cache){let builds:string[]=[];try{builds=await readdir(cache);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      for(const build of builds){const path=join(cache,build,version,'python',process.platform==='win32'?'python.exe':'bin/python3');if(await executable(path))candidates.push(path);}}
    if(candidates.length!==1)throw new Error('无法唯一定位当前 iCode 的原生 Python；请配置 DEMO_ICODE_PYTHON 后核验，未使用其他解析器');
    python=candidates[0];
  }
  const environment=JSON.parse((await exec(python,['-I',script,'--environment'],{cwd:root,timeout:15000,maxBuffer:65536,windowsHide:true})).stdout);
  if(environment.nativeVersion!==version||typeof environment.configDirectory!=='string'||!isAbsolute(environment.configDirectory))throw new Error('原生 Python 与 iCode 版本或配置目录不匹配');
  const configDirectory=await realpath(environment.configDirectory);
  const sessionRoot=typeof environment.sessionRoot==='string'&&isAbsolute(environment.sessionRoot)?environment.sessionRoot:join(configDirectory,'sessions');
  return {python,version,configDirectory,sessionRoot};
}
export async function nativeSkillEnvironment() {
  const environment=await nativePlatformEnvironment();
  return {...environment,skillsDirectory:join(environment.configDirectory,'skills')};
}
export async function readInstalledNativeSkill(directory:string,pkg:NativeSkillPackage):Promise<SkillApplicationReceipt['discovery']>{
  const runtime=await nativeSkillEnvironment();
  if(await realpath(directory)!==await realpath(runtime.skillsDirectory))throw new Error('应用目录与原生用户 Skill 目录不一致');
  const target=await realpath(join(directory,pkg.name));
  const proof=await readUnchangedSkillPackage(directory,pkg,async()=>JSON.parse((await exec(runtime.python,['-I',script,target,pkg.name],{cwd:root,timeout:30000,maxBuffer:1048576,windowsHide:true})).stdout));
  if(proof.nativeVersion!==runtime.version||proof.source!==target||proof.name!==pkg.name||proof.primarySha256!==pkg.files.find(file=>file.path==='SKILL.md')!.sha256||proof.modelCalls!==0||proof.scriptsExecuted!==0)throw new Error('原生发现与读取证据不匹配');
  const evidencePath=join(runtimeDir,'skill-applications','native-read-'+randomUUID()+'.json');await atomicJson(evidencePath,{...proof,packageSha256:pkg.sha256,version:pkg.version,verifiedAt:new Date().toISOString()});
  return {status:'discovered-and-read',source:target,nativeVersion:runtime.version,evidencePath,note:'已由当前 iCode 默认角色的实际发现链读取本机用户包与引用资源；未运行 Skill 脚本或调用模型，也未向已有会话注入或重载。'};
}
