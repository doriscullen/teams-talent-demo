import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,open,rename,unlink,mkdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename,isAbsolute} from 'node:path';
const exec=promisify(execFile);
export const carddemoSubdirectory='workspace/carddemo-java-1025';
export const configurationPath=repo=>join(repo,'teams','.local','carddemo-workspace.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const git=async(repo,args)=>(await exec('git',[...(process.platform==='win32'?['-c','core.longpaths=true']:[]),'-C',repo,...args],{encoding:'utf8',maxBuffer:2*1024*1024,windowsHide:true})).stdout.trim();
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function json(path){try{if((await lstat(path)).isSymbolicLink())throw Error('不允许配置软链接：'+path);return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function canonical(path){if(!isAbsolute(path))throw Error('目录必须为绝对路径');const absolute=resolve(path);if(await realpath(absolute)!==absolute)throw Error('目录不能通过软链接或别名绑定：'+path);return absolute;}
async function common(repo){return canonical(resolve(repo,await git(repo,['rev-parse','--git-common-dir'])));}
async function head(repo){return git(repo,['rev-parse','HEAD']);}
async function branch(repo){return git(repo,['symbolic-ref','--quiet','--short','HEAD']);}
async function ref(repo,name){try{return await git(repo,['rev-parse','--verify','--quiet',name]);}catch(error){if(error.code===1)return null;throw error;}}
async function ancestor(repo,from,to){try{await git(repo,['merge-base','--is-ancestor',from,to]);return true;}catch(error){if(error.code===1)return false;throw error;}}
async function identity(platformRoot){const root=await canonical(platformRoot);if(await canonical(await git(root,['rev-parse','--show-toplevel']))!==root)throw Error('平台目录必须是仓库根目录');if(await branch(root)!=='main')throw Error('平台工作区必须保持 main；工具不会切换分支');if(!(await lstat(join(root,'.git'))).isDirectory())throw Error('平台入口必须为原始仓库，不允许从业务 worktree 初始化');const remoteUrl=await git(root,['remote','get-url','origin']);if(!remoteUrl||/[\r\n\0]/.test(remoteUrl))throw Error('origin 配置无效');if(/^https?:\/\/[^/]*@/.test(remoteUrl))throw Error('origin URL 不应包含凭据');return{platformRoot:root,commonDirectory:await common(root),remote:'origin',remoteUrl};}
async function atomic(path,value){await mkdir(dirname(path),{recursive:true});await canonical(dirname(path));const tmp=path+'.'+randomUUID()+'.tmp',file=await open(tmp,'wx',0o600);try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}try{await rename(tmp,path);}catch(error){await unlink(tmp);throw error;}}
const localQueues=new Map();
function locked(repo,operation){const next=(localQueues.get(repo)??Promise.resolve()).catch(()=>{}).then(()=>fileLocked(repo,operation));localQueues.set(repo,next);return next.finally(()=>{if(localQueues.get(repo)===next)localQueues.delete(repo);});}
async function fileLocked(repo,operation){const path=join(repo,'teams','.local','carddemo-workspace.lock');await mkdir(dirname(path),{recursive:true});await canonical(dirname(path));let handle;try{handle=await open(path,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('CardDemo 初始化正在执行或前次中断；请先核验本机锁文件，未并发覆盖');throw error;}try{await handle.writeFile(String(process.pid));await handle.sync();return await operation();}finally{await handle.close();await unlink(path);}}
async function validateWorktree(config,worktreeRoot,expectedBranch,baseCommit){
 const worktree=await canonical(worktreeRoot);if(worktree===config.platformRoot||dirname(worktree)!==dirname(config.platformRoot))throw Error('业务 worktree 必须为平台仓库的独立同级目录');
 if(await canonical(await git(worktree,['rev-parse','--show-toplevel']))!==worktree||await common(worktree)!==config.commonDirectory)throw Error('工作目录不属于已登记的同一 Git 仓库');
 if(await git(worktree,['remote','get-url','origin'])!==config.remoteUrl)throw Error('origin 仓库身份已变化');if(await branch(worktree)!==expectedBranch)throw Error('业务工作区分支与登记不符');
 if(!(await lstat(join(worktree,'.git'))).isFile())throw Error('业务工作区必须为 Git worktree（.git 文件）');if(!await ancestor(worktree,baseCommit,'HEAD'))throw Error('任务分支不包含已登记的 develop 基线');
 const directory=await canonical(join(worktree,carddemoSubdirectory));if(!await exists(join(directory,'pom.xml')))throw Error('基线中缺少 CardDemo pom.xml');return directory;
}
export async function readCarddemoWorkspace(platformRoot){
 const config=await json(configurationPath(platformRoot));if(config===null)return null;
 if(config.version!==1||!Number.isFinite(Date.parse(config.enabledAt))||config.projectId!=='carddemo'||config.remote!=='origin'||config.baseBranch!=='develop'||config.businessSubdirectory!==carddemoSubdirectory||typeof config.remoteUrl!=='string'||!isAbsolute(config.platformRoot??'')||!isAbsolute(config.commonDirectory??'')||!isAbsolute(config.baseWorktreeRoot??'')||!/^[a-f0-9]{40}$/.test(config.baseCommit??''))throw Error('CardDemo 工作区配置损坏，未忽略');
 const actual=await identity(platformRoot);for(const key of ['platformRoot','commonDirectory','remoteUrl'])if(config[key]!==actual[key])throw Error('CardDemo 工作区仓库身份不匹配：'+key);
 await validateWorktree(config,config.baseWorktreeRoot,'develop',config.baseCommit);return config;
}
async function worktreeEntries(repo){const output=await git(repo,['worktree','list','--porcelain','-z']);return output.split('\0\0').filter(Boolean).map(block=>{const entry={};for(const line of block.split('\0')){const split=line.indexOf(' ');if(split>0)entry[line.slice(0,split)]=line.slice(split+1);}return entry;});}
function sibling(repo,path,defaultName){const location=resolve(path??join(dirname(repo),defaultName));if(location===repo||dirname(location)!==dirname(repo))throw Error('worktree 路径必须为仓库的独立同级目录');return location;}
async function placement(repo,path,name,baseCommit){const entries=await worktreeEntries(repo),occupied=entries.find(entry=>entry.branch==='refs/heads/'+name);if(occupied&&resolve(occupied.worktree)!==path)throw Error('分支已在其它 worktree 使用：'+name);if(await exists(path)){if(!occupied)throw Error('目标目录已存在且并非该已登记 worktree，不覆盖');if(await head(path)!==baseCommit)throw Error('未登记 worktree 的当前提交与精确基线冲突');return 'reuse';}const existing=await ref(repo,'refs/heads/'+name);if(existing&&existing!==baseCommit)throw Error('同名分支与精确基线冲突：'+name);return existing?'attach-existing-branch':'create-branch';}
async function initPlan(options){
 const info=await identity(resolve(options.repo));if(options.expectedOrigin&&options.expectedOrigin!==info.remoteUrl)throw Error('origin 与 expected-origin 不匹配');const existing=await readCarddemoWorkspace(info.platformRoot);
 if(existing){if(options.baseCommit&&options.baseCommit!==existing.baseCommit||options.worktree&&resolve(options.worktree)!==existing.baseWorktreeRoot)throw Error('已登记初始化参数不同，未覆盖配置');return{kind:'initialize',action:'reuse',...existing,directory:join(existing.baseWorktreeRoot,carddemoSubdirectory),developHead:await head(existing.baseWorktreeRoot),configurationFile:configurationPath(info.platformRoot)};}
 if(!/^[a-f0-9]{40}$/.test(options.baseCommit??''))throw Error('首次初始化必须指定明确的 --base-commit 40位提交SHA');const base=options.baseCommit;
 if(await git(info.platformRoot,['rev-parse',base+'^{commit}'])!==base)throw Error('基线不是已存在的提交');
 const remoteMain=await ref(info.platformRoot,'refs/remotes/origin/main'),remoteDevelop=await ref(info.platformRoot,'refs/remotes/origin/develop');if(base!==remoteMain&&base!==remoteDevelop)throw Error('基线必须精确匹配已获取的 origin/main 或 origin/develop；请先显式 fetch 并核对');
 if(remoteDevelop&&remoteDevelop!==base)throw Error('origin/develop 与指定初始基线不同，未另建冲突 develop');
 const baseWorktreeRoot=sibling(info.platformRoot,options.worktree,basename(info.platformRoot)+'-carddemo-develop');const action=await placement(info.platformRoot,baseWorktreeRoot,'develop',base);
 const config={version:1,enabledAt:new Date().toISOString(),projectId:'carddemo',...info,baseBranch:'develop',baseCommit:base,businessSubdirectory:carddemoSubdirectory,baseWorktreeRoot};if(action==='reuse')await validateWorktree(config,baseWorktreeRoot,'develop',base);
 return{kind:'initialize',action,...config,directory:join(baseWorktreeRoot,carddemoSubdirectory),developHead:base,configurationFile:configurationPath(info.platformRoot)};
}
export async function initializeCarddemoWorkspace(options){
 const preview=await initPlan(options);if(!options.apply)return{...preview,applied:false};return locked(preview.platformRoot,async()=>{const plan=await initPlan(options);if(plan.action!=='reuse')await git(plan.platformRoot,['worktree','add',...(plan.action==='create-branch'?['-b','develop']:[]),plan.baseWorktreeRoot,plan.action==='create-branch'?plan.baseCommit:'develop']);
 const {kind,action,directory,developHead,configurationFile,...config}=plan;await validateWorktree(config,config.baseWorktreeRoot,'develop',config.baseCommit);if(!await exists(configurationFile))await atomic(configurationFile,config);return{...plan,applied:true};});
}
function taskSlug(id){if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{2,100}$/.test(id))throw Error('任务ID格式无效');return id.toLowerCase().slice(0,64)+'-'+sha(id).slice(0,8);}
async function bindings(runtime){const path=join(runtime,'project-task-directory-bindings.json'),value=await json(path);if(value===null)return{version:1,bindings:[]};if(value.version!==1||!Array.isArray(value.bindings))throw Error('任务目录绑定文件损坏');const seen=new Set(),worktrees=new Set();for(const item of value.bindings){if(!item||typeof item.projectId!=='string'||typeof item.taskId!=='string')throw Error('任务目录绑定身份无效');const key=JSON.stringify([item.projectId,item.taskId]);if(seen.has(key))throw Error('任务目录绑定身份重复');seen.add(key);if(item.kind==='carddemo-worktree'){if(!isAbsolute(item.worktreeRoot??''))throw Error('任务worktree路径无效');const directory=resolve(item.worktreeRoot);if(worktrees.has(directory))throw Error('不同任务不能共用一个已登记worktree');worktrees.add(directory);}}return value;}
export async function validateCarddemoTaskBinding(platformRoot,task,binding){
 const config=await readCarddemoWorkspace(platformRoot);if(!config)throw Error('尚未初始化 CardDemo develop 工作区');if(task.projectId!=='carddemo'||binding.projectId!==task.projectId||binding.taskId!==task.id||binding.kind!=='carddemo-worktree')throw Error('CardDemo 任务绑定范围不匹配');
 if((task.workDirectory??null)!==binding.recordedDirectory)throw Error('需求登记目录已变化，原绑定未被静默替换');for(const key of ['platformRoot','commonDirectory','remote','remoteUrl'])if(binding[key]!==config[key])throw Error('任务绑定仓库身份不匹配：'+key);
 if(binding.baseBranch!=='develop'||!/^[a-f0-9]{40}$/.test(binding.baseCommit??'')||binding.branch!=='codex/carddemo-'+taskSlug(task.id)||!isAbsolute(binding.worktreeRoot??''))throw Error('任务分支或基线字段无效');
 if(!await ancestor(config.platformRoot,binding.baseCommit,'refs/heads/develop'))throw Error('任务基线已不在当前 develop 历史中');const directory=await validateWorktree(config,binding.worktreeRoot,binding.branch,binding.baseCommit);if(binding.directory!==directory)throw Error('任务绑定必须精确指向 CardDemo 子目录');return binding;
}
export async function readCarddemoTaskBinding(platformRoot,runtime,task){const value=await bindings(runtime),binding=value.bindings.find(item=>item.projectId===task.projectId&&item.taskId===task.id);if(!binding||binding.kind!=='carddemo-worktree')return null;return validateCarddemoTaskBinding(platformRoot,task,binding);}
async function selectedTask(runtime,projectId,taskId){if(projectId!=='carddemo')throw Error('此工具仅初始化 carddemo 任务');const state=await json(join(runtime,'state.json'));if(!state||state.schemaVersion!==2)throw Error('Teams 状态缺失或无效');const matches=(state.workspace?.deliveryRequirements??[]).filter(task=>task.projectId===projectId&&task.id===taskId);if(matches.length!==1)throw Error('没有唯一的本地任务，未创建绑定');return{state,task:matches[0]};}
function unusedTask(state,task,preparationId){const preparation=state.workspace.taskAutomation?.find(item=>item.projectId===task.projectId&&item.taskId===task.id)?.preparation;if(preparationId&&(preparation?.id!==preparationId||preparation.status!=='preparing-session'||preparation.session))throw Error('准备请求在工作区初始化期间变化，未写入过时绑定');if(task.stage!=='preparing'||task.preparedAt||!['prepare','develop','verify','accept'].every(node=>task.nodes?.[node]?.status==='pending')||preparation&&['preparing-session','ready'].includes(preparation.status)&&!(preparation.status==='preparing-session'&&preparation.id===preparationId&&!preparation.session))throw Error('任务已执行或已有准备会话，不能切换其工作目录；请保留原会话并新建任务');}
async function taskPlan(options){const config=await readCarddemoWorkspace(resolve(options.repo));if(!config)throw Error('请先显式初始化 CardDemo develop 工作区');const runtime=await canonical(resolve(options.runtime));const {state,task}=await selectedTask(runtime,options.projectId,options.taskId),saved=await bindings(runtime),old=saved.bindings.find(item=>item.projectId===task.projectId&&item.taskId===task.id);
 if(old){const binding=await validateCarddemoTaskBinding(config.platformRoot,task,old);return{kind:'task',action:'reuse',binding,runtime,bindingFile:join(runtime,'project-task-directory-bindings.json')};}
 unusedTask(state,task,options.preparationId);const baseCommit=await head(config.baseWorktreeRoot),name='codex/carddemo-'+taskSlug(task.id),worktreeRoot=sibling(config.platformRoot,options.worktree,basename(config.platformRoot)+'-carddemo-'+taskSlug(task.id)),action=await placement(config.platformRoot,worktreeRoot,name,baseCommit);
 const binding={kind:'carddemo-worktree',projectId:task.projectId,taskId:task.id,recordedDirectory:task.workDirectory??null,directory:join(worktreeRoot,carddemoSubdirectory),worktreeRoot,branch:name,baseBranch:'develop',baseCommit,platformRoot:config.platformRoot,commonDirectory:config.commonDirectory,remote:'origin',remoteUrl:config.remoteUrl};if(action==='reuse')await validateCarddemoTaskBinding(config.platformRoot,task,binding);return{kind:'task',action,binding,runtime,bindingFile:join(runtime,'project-task-directory-bindings.json')};
}
export async function initializeCarddemoTask(options){const preview=await taskPlan(options);if(!options.apply)return{...preview,applied:false};return locked(preview.binding.platformRoot,async()=>{const plan=await taskPlan(options),b=plan.binding;if(plan.action!=='reuse')await git(b.platformRoot,['worktree','add',...(plan.action==='create-branch'?['-b',b.branch]:[]),b.worktreeRoot,plan.action==='create-branch'?b.baseCommit:b.branch]);
 const {state,task}=await selectedTask(plan.runtime,b.projectId,b.taskId),saved=await bindings(plan.runtime),existing=saved.bindings.find(item=>item.projectId===b.projectId&&item.taskId===b.taskId);if(!existing){unusedTask(state,task,options.preparationId);await validateCarddemoTaskBinding(b.platformRoot,task,b);if(saved.bindings.some(item=>item.kind==='carddemo-worktree'&&resolve(item.worktreeRoot)===b.worktreeRoot))throw Error('该工作区已绑定其它任务，未覆盖');saved.bindings.push(b);await atomic(plan.bindingFile,saved);}else if(JSON.stringify(existing)!==JSON.stringify(b))throw Error('绑定在初始化期间变化，未覆盖');return{...plan,applied:true};});}

/** Called only by an explicit/background preparation write path, never by GET plan. */
export async function ensureCarddemoTaskWorkspace(options){
 if(options.projectId!=='carddemo')return null;const config=await readCarddemoWorkspace(resolve(options.repo));if(!config)return null;
 const {state,task}=await selectedTask(options.runtime,options.projectId,options.taskId),existing=await readCarddemoTaskBinding(config.platformRoot,options.runtime,task);if(existing)return existing;
 if(!Number.isFinite(Date.parse(task.createdAt))||Date.parse(task.createdAt)<Date.parse(config.enabledAt))throw Error('该任务创建于隔离工作区启用前，请显式 task init 后再重试；未迁移原任务');
 const preparation=state.workspace.taskAutomation?.find(item=>item.projectId===task.projectId&&item.taskId===task.id)?.preparation;
 if(!options.preparationId||preparation?.id!==options.preparationId||preparation.status!=='preparing-session'||preparation.session)throw Error('自动创建工作区必须属于当前已确认准备请求');
 return (await initializeCarddemoTask({...options,apply:true})).binding;
}
