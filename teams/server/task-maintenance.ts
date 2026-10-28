import {mkdir,open,readFile,unlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
/** Serialize lease changes. An interrupted guard is deliberately not guessed away. */
async function gate(runtime:string,action:()=>Promise<void>){
 const path=join(runtime,'task-maintenance.guard');let file;
 try{file=await open(path,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('维护锁正在更新或上次异常中断；请核验 task-maintenance.guard 后再重试');throw error;}
 try{await file.writeFile(String(process.pid));await file.sync();await action();}finally{await file.close();await unlink(path);}
}
/** The service and offline maintenance share one exclusive runtime writer lease. */
export async function acquireTaskMaintenance(runtime:string,kind:'service'|'reset'){
 await mkdir(runtime,{recursive:true});const path=join(runtime,'task-maintenance.lock.json'),token=randomUUID();
 await gate(runtime,async()=>{
  let bytes:string|null=null;try{if((await lstat(path)).isSymbolicLink())throw Error('维护锁不允许软链接');bytes=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(bytes!==null){const owner=JSON.parse(bytes);if(owner.version!==1||!['service','reset'].includes(owner.kind)||!Number.isSafeInteger(owner.pid)||owner.pid<2||typeof owner.token!=='string')throw Error('维护锁损坏，未接管');
   let dead=false;try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')dead=true;else throw error;}
   if(!dead)throw Error('该状态目录正在由 '+owner.kind+' 进程占用（PID '+owner.pid+'），未写入');await unlink(path);
  }
  const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify({version:1,kind,pid:process.pid,token}));await file.sync();}finally{await file.close();}
 });
 return async()=>gate(runtime,async()=>{const owner=JSON.parse(await readFile(path,'utf8'));if(owner.token!==token)throw Error('维护锁身份已变化，未删除');await unlink(path);});
}
