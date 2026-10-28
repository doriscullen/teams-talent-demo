import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {ProjectWorkReceipt,ProjectWorkStatus} from '../src/project-work.js';
import {nativeProcessActive,inspectNativeProcess} from '../scripts/native/session-liveness.mjs';

/** Only fixed server-owned run paths are read; raw model/tool output is never returned. */
export async function nativeWorkExecution(runtime:string,receipt:ProjectWorkReceipt):Promise<ProjectWorkStatus['execution']>{
 const root=join(runtime,'work-contexts',receipt.requestId+'.native');
 const logPaths={stdout:join(root,'stdout.json'),stderr:join(root,'stderr.log'),result:join(root,'result.json')};
 const read=async(name:string)=>{try{const path=join(root,name);if(await realpath(path)!==path)throw new Error('作业记录路径不能被链接替换');return JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
 const matches=(value:any)=>value?.runId===receipt.requestId&&value.projectId===receipt.target.projectId&&value.taskId===receipt.target.taskId&&value.nodeId===receipt.target.nodeId;
 const manifest=await read('manifest.json');
 if(manifest&&(!matches({...manifest.scope,runId:manifest.runId})||manifest.executionMode!==receipt.executionMode))throw new Error('作业材料范围或模式不一致');
 const owner=await read('native-session.json'),result=await read('result.json'),processRecord=await read('process.json'),error=await read('launch-error.json');
 if(owner&&(!matches(owner)||owner.sessionRoot!==join(root,'session-root')||!/^[-a-f0-9]{36}$/i.test(owner.sessionId)||receipt.sessionId&&owner.sessionId!==receipt.sessionId))throw new Error('原生会话身份与请求不一致');
 if(result){if(!matches(result)||!['completed','failed'].includes(result.status)||result.executionMode&&result.executionMode!==receipt.executionMode||result.sessionId&&result.sessionId!==owner?.sessionId)throw new Error('原生退出记录与请求不一致');return {status:result.status,sessionId:owner?.sessionId??null,pid:result.pid,startedAt:result.startedAt,finishedAt:result.finishedAt,exitCode:result.nativeExitCode,...(result.error?{error:result.error}:{}),logPaths};}
 if(error){if(!matches(error))throw new Error('启动错误记录范围不一致');return {status:'failed',sessionId:owner?.sessionId??null,error:error.error,finishedAt:error.at,logPaths};}
 if(owner){const active=await nativeProcessActive(owner,processRecord);return {status:active?'running':'unknown',sessionId:owner.sessionId,pid:owner.pid,startedAt:owner.startedAt,...(!active?{error:'原生进程已不活动，尚无可核验退出结果；未声明完成'}:{}),logPaths};}
 const launch=await read('cli-launch.json');
 if(launch){if(!matches(launch))throw new Error('CLI 启动记录范围不一致');const process=await inspectNativeProcess(launch.pid);const active=process&&!process.state.startsWith('Z')&&Date.parse(process.startedAt)<=Date.parse(launch.startedAt)+1000&&Date.parse(process.startedAt)>=Date.parse(launch.startedAt)-2000;return {status:active?'pending':'unknown',sessionId:null,pid:launch.pid,startedAt:launch.startedAt,...(!active?{error:'启动观察器已不活动，尚无原生会话或退出结果'}:{}),logPaths};}
 return {status:'pending',sessionId:null,logPaths};
}
