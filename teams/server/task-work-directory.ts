import {readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
/** Explicit machine-local relocation; never rewrites a task's historical directory or inputs. */
export async function taskWorkDirectory(runtime:string,task:{projectId:string;id:string;workDirectory?:string}) {
  const path=join(runtime,'project-task-directory-bindings.json');
  let value:any;
  try{value=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return task.workDirectory;throw error;}
  if(value?.version!==1||!Array.isArray(value.bindings))throw new Error('本机任务目录绑定记录无效');
  const identities=new Set<string>();
  for(const item of value.bindings){
    if(!item||typeof item.projectId!=='string'||typeof item.taskId!=='string'||!isAbsolute(item.recordedDirectory??'')||!isAbsolute(item.directory??'')||typeof item.gitConfigSha256!=='string'||!/^[a-f0-9]{64}$/.test(item.gitConfigSha256))throw new Error('本机任务目录绑定字段无效');
    const key=JSON.stringify([item.projectId,item.taskId]);if(identities.has(key))throw new Error('本机任务目录绑定重复');identities.add(key);
  }
  const binding=value.bindings.find((item:any)=>item.projectId===task.projectId&&item.taskId===task.id);
  if(!binding)return task.workDirectory;
  if(binding.recordedDirectory!==task.workDirectory)throw new Error('本机任务目录绑定与需求登记来源不一致');
  const config=await readFile(join(binding.directory,'.git','config'));
  if(createHash('sha256').update(config).digest('hex')!==binding.gitConfigSha256)throw new Error('已迁移的本机Git目录配置发生变化，请重新核验绑定');
  return binding.directory as string;
}
