import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,relative,dirname,extname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DomainError,type DemoState,type Role} from '../src/domain.js';
import {deliveryRequirement,type DeliveryRequirement,type RequirementNode} from '../src/delivery-requirements.js';
import {projectMembers} from '../src/teams-domain.js';
import type {TaskArtifactQuery,TaskArtifactContent} from '../src/task-artifact-content.js';
import {taskWorkDirectory} from './task-work-directory.js';
import {canonicalDirectory,contained,readTaskArtifactRoots} from '../scripts/lib/task-artifact-roots.mjs';
const exec=promisify(execFile),MAX_BYTES=1024*1024;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function fail(message:string,status=409):never {throw new DomainError(message,status);}
interface Options {runtime:string;teamsRoot:string;directory?:(task:DeliveryRequirement)=>Promise<string|undefined>}
async function checkedFile(path:string,root:string){
 await canonicalDirectory(root);
 if(!contained(root,path)||resolve(path)!==path)fail('资料路径不在已核验的本任务目录内',403);
 let at=path;while(at!==root){const stat=await lstat(at);if(stat.isSymbolicLink())fail('资料路径不允许符号链接',403);at=dirname(at);}
 if(await realpath(path)!==path)fail('资料真实路径与登记路径不一致',403);
}
/** Resolve only a saved result identity. The browser never supplies a filesystem path. */
export async function readTaskArtifactContent(state:DemoState,role:Role,query:TaskArtifactQuery,options:Options):Promise<TaskArtifactContent>{
 if(role!=='owner'&&role!=='member')fail('请选择角色',400);
 if(!query||Object.keys(query).some(key=>!['projectId','taskId','nodeId','artifactId','version'].includes(key))||!['prepare','develop','verify','accept'].includes(query.nodeId)||typeof query.version!=='string')fail('产物查询范围无效',400);
 const task=deliveryRequirement(state,query.projectId,query.taskId);if(!task)fail('任务不存在',404);
 if(!projectMembers(state,query.projectId).some(member=>member.id===role&&member.status==='active'))fail('无权读取此项目资料',403);
 const match=/^artifact:([^:]+):(\d+)$/.exec(query.artifactId);if(!match)fail('此项不是已登记的任务产物',404);
 const event=state.workspace.collaboration?.events.find(item=>item.id===match![1]&&item.projectId===query.projectId&&item.taskId===query.taskId&&item.nodeId===query.nodeId&&item.phase==='result');
 const evidence=event?.evidence[Number(match![2])];if(!evidence||query.artifactId!==`artifact:${event!.id}:${Number(match![2])}`)fail('当前任务节点未登记此项产物',404);
 if((evidence.version??'')!==query.version)fail('请求版本与已登记产物不一致');
 const base={artifactId:query.artifactId,projectId:query.projectId,taskId:query.taskId,nodeId:query.nodeId,title:evidence.description,version:evidence.version??null,...(evidence.codeVersion?{codeVersion:evidence.codeVersion}:{})};
 if(evidence.kind==='reference'){
  let url:URL;try{url=new URL(evidence.value);}catch{return fail('此引用未登记可打开的网页地址',422);}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||!/^\/[^/]+\/[^/]+\/(pull\/\d+|commit\/[a-f\d]{40})\/?$/i.test(url.pathname)||url.search||url.hash)fail('此引用不是已支持的 GitHub PR／提交地址',422);
  return {...base,kind:'link',url:url.href,integrity:'saved-link',note:'链接来自本任务已保存的产物记录。'};
 }
 if(evidence.kind!=='local-file'||!isAbsolute(evidence.value))fail('产物没有有效的本地文件引用',422);
 const path=evidence.value;
 if(!['.md','.markdown','.txt','.json','.log','.csv','.xml','.yaml','.yml','.html'].includes(extname(path).toLowerCase()))fail('此文件格式暂不支持正文预览',415);
 const directory=await(options.directory?options.directory(task):taskWorkDirectory(options.runtime,task,resolve(options.teamsRoot,'..')));
 const bound=directory?await canonicalDirectory(directory):undefined;
 const registered=await readTaskArtifactRoots({...options,projectId:task.projectId,taskId:task.id});
 const root=[...(bound?[bound]:[]),...registered.map(row=>row.directory)].find(root=>contained(root,path));if(!root)fail('此资料不在任务工作目录或已登记的任务报告目录，请先核验登记',403);
 await checkedFile(path,root);
 const entry=await lstat(path);if(!entry.isFile()||entry.size>MAX_BYTES)fail('正文必须为不超过 1 MiB 的普通文件',413);
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));let bytes:Buffer;
 try{const before=await file.stat();if(!before.isFile()||before.size>MAX_BYTES)fail('正文必须为不超过 1 MiB 的普通文件',413);const buffer=Buffer.alloc(MAX_BYTES+1);let length=0;while(length<buffer.length){const read=await file.read(buffer,length,buffer.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}bytes=buffer.subarray(0,length);const after=await file.stat();const current=await lstat(path);if(bytes.length>MAX_BYTES||before.size!==after.size||before.mtimeMs!==after.mtimeMs||after.ino!==current.ino||after.dev!==current.dev)fail('读取期间文件发生变化，请重试');await checkedFile(path,root);}finally{await file.close();}
 let integrity:TaskArtifactContent['integrity']='current-file',note='未登记提交时内容 SHA；此处展示当前文件内容。';
 // A codeVersion may identify a historical design file: read that exact reachable commit, never relabel HEAD bytes.
 if(bound&&bound===root&&evidence.codeVersion){
  if(!/^[a-f\d]{40}$/i.test(evidence.codeVersion))fail('产物代码版本不是完整提交 SHA');
  await exec('git',['-C',bound,'merge-base','--is-ancestor',evidence.codeVersion,'HEAD']).catch(()=>fail('产物代码版本不属于本任务工作树历史'));
  const {stdout:top}=await exec('git',['-C',bound,'rev-parse','--show-toplevel']);const repo=await realpath(top.trim());
  if(repo!==bound&&!contained(repo,bound))fail('业务绑定目录不在已核验工作树内',403);
  const gitPath=relative(repo,path).split('\\').join('/');
  const result=await exec('git',['-C',bound,'show',`${evidence.codeVersion}:${gitPath}`],{encoding:'buffer',maxBuffer:MAX_BYTES,windowsHide:true}).catch(()=>fail('无法读取此提交中的已登记文档版本'));
  bytes=result.stdout;integrity='git-commit';note='正文读取自本任务工作树历史中的已登记代码提交。';
 }
 const actual=hash(bytes),record=evidence as typeof evidence&{sha256?:string;contentSha256?:string};
 for(const expected of [record.sha256,record.contentSha256].filter(value=>value!==undefined)){
  if(typeof expected!=='string'||!/^[a-f\d]{64}$/i.test(expected)||expected.toLowerCase()!==actual)fail('正文与已登记内容 SHA256 不一致');integrity='registered-sha256';note='正文与提交时登记的内容 SHA256 一致。';
 }
 let content:string;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{return fail('正文不是有效 UTF-8 文本',415);}
 if(content.includes('\u0000'))fail('正文包含二进制内容，不能作为文本预览',415);
 return {...base,kind:'document',content,sha256:actual,bytes:bytes.length,integrity,note};
}
