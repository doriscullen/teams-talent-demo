#!/usr/bin/env node
import {readFile,mkdir,open,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {runtimeDir,origin as configuredOrigin} from '../server/config.ts';
const help=`Teams iCode 作业 CLI
plan | start | status
--endpoint http://127.0.0.1:45970 --role owner|member
--project ID --task ID --node prepare|develop|verify [--mode cli]
start: --mode cli --instruction-file FILE (或 --instruction TEXT) --request-id UUID
status: --request-id 原请求UUID
--receipt-dir DIR 本地请求/回执目录（同一逻辑启动重试必须保留原 ID 和指令）
plan/status 只读。start 仅恢复本任务已准备且不活动的真实会话，不创建/采用输入、不自动推进节点。
UI 仍默认 TUI；CLI 明确工作指令只授权本次节点。未就绪请先在 Teams 完成准备。
stdout 为计划/启动回执/真实作业状态；日志路径用于本机核对，原生正文不在 stdout 重复打印。
退出码：0 请求成功（不等于业务完成）；1 请求/参数失败；2 status 观察到 failed 或 unknown。`;
let requestPath;
async function atomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}await rename(temp,path);}
try{
 const args=process.argv.slice(2),o={},pos=[];const names=new Set(['endpoint','role','project','task','node','mode','instruction','instruction-file','request-id','receipt-dir']);
 for(let i=0;i<args.length;i++){if(['--help','-h'].includes(args[i])){console.log(help);process.exit(0);}if(!args[i].startsWith('--')){pos.push(args[i]);continue;}const key=args[i].slice(2);if(!names.has(key)||Object.hasOwn(o,key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('未知、重复或缺少值的参数：'+args[i]);o[key]=args[++i];}
 const command=pos.join(' ');if(!['plan','start','status'].includes(command))throw new Error(help);
 if(!['owner','member'].includes(o.role)||!o.project||!o.task||!['prepare','develop','verify'].includes(o.node))throw new Error('必须明确 role/project/task/node');
 if(o.mode&&o.mode!=='cli'||command==='start'&&o.mode!=='cli')throw new Error('CLI 启动必须显式 --mode cli');
 if(command!=='start'&&(o.instruction||o['instruction-file']))throw new Error('工作指令只供 start 使用');
 const endpoint=new URL(o.endpoint??process.env.DEMO_ORIGIN??configuredOrigin);if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw new Error('只允许明确本机 HTTP origin');
 const base=endpoint.origin,target={projectId:o.project,tab:'delivery',taskId:o.task,nodeId:o.node};
 const getQuery=new URLSearchParams({role:o.role,...target});
 async function request(path,body,token){const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'content-type':'application/json',origin:base,'x-demo-token':token},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw new Error(`HTTP ${response.status}: ${value.error??'请求失败'}`);return value;}
 const health=await request('/api/health');if(health.app!=='teams-talent-carddemo'||health.service!=='teams')throw new Error('目标不是 Teams 服务');
 let result;
 if(command==='plan')result=await request('/api/project-work?'+getQuery+'&mode=cli');
 else{
  const id=o['request-id'];if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id??''))throw new Error('需要稳定 --request-id UUID');
  if(command==='status'){result=await request('/api/native/work-status?'+getQuery+'&requestId='+encodeURIComponent(id));if(['failed','unknown'].includes(result.execution?.status))process.exitCode=2;}
  else{
   if(Boolean(o.instruction)===Boolean(o['instruction-file']))throw new Error('需且仅需 instruction 或 instruction-file');
   const instruction=(o.instruction??await readFile(resolve(o['instruction-file']),'utf8')).trim();if(!instruction||instruction.length>20000||instruction.includes('\0'))throw new Error('工作指令必须为 1–20000 字符');
   const identity={endpoint:base,role:o.role,target,mode:'cli',instruction,requestId:id};
   const key=createHash('sha256').update(base+':'+id).digest('hex');requestPath=join(resolve(o['receipt-dir']??join(runtimeDir,'work-cli-receipts')),key+'.request.json');
   let envelope;
   try{envelope=JSON.parse(await readFile(requestPath,'utf8'));if(JSON.stringify(envelope.identity)!==JSON.stringify(identity))throw new Error('相同请求 ID 已用于不同范围或工作指令；拒绝覆盖');}
   catch(error){if(error.code!=='ENOENT')throw error;const plan=await request('/api/project-work?'+getQuery+'&mode=cli');const action=plan.actions.find(item=>item.id===plan.defaultAction);if(plan.defaultAction!=='resume'||!action?.enabled)throw new Error(action?.reason??'当前没有可恢复的已准备会话');envelope={identity,payload:{role:o.role,requestId:id,target:plan.target,action:'resume',planToken:plan.planToken,mode:'cli',instruction}};await mkdir(dirname(requestPath),{recursive:true});try{const f=await open(requestPath,'wx',0o600);try{await f.writeFile(JSON.stringify(envelope,null,2)+'\n');await f.sync();}finally{await f.close();}}catch(error){if(error.code!=='EEXIST')throw error;const existing=JSON.parse(await readFile(requestPath,'utf8'));if(JSON.stringify(existing.identity)!==JSON.stringify(identity))throw new Error('并发请求 ID 冲突');envelope=existing;}}
   const session=await request('/api/session');const receipt=await request('/api/native/work-start',envelope.payload,session.token);const receiptPath=requestPath.replace('.request.json','.receipt.json');await atomic(receiptPath,receipt);result={receipt,requestPath,receiptPath};if(['uncertain','prepared'].includes(receipt.status))process.exitCode=2;
  }
 }
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({ok:false,error:error.message,...(requestPath?{requestPath,note:'请求可能已被受理；先用原 request-id 查询 status，不换 ID 重复启动。'}:{})},null,2));process.exitCode=1;}
