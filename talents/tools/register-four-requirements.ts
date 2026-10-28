/** Explicit local API registration. Default dry run; no service launch, reset or task creation. */
import { appendFourRequirements } from '../server/four-requirements.ts';
import { buildExport } from '../server/export.ts';
import { fourRequirementScenarios, fourRequirementScenariosV2 } from '../../shared/four-requirement-scenarios.ts';
const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.some((a,i)=>a!=='--apply'&&a!=='--endpoint'&&a!=='--version'&&args[i-1]!=='--endpoint'&&args[i-1]!=='--version')||args.filter(a=>a==='--endpoint').length!==1||args.filter(a=>a==='--version').length>1)throw new Error('用法：node --import tsx tools/register-four-requirements.ts --endpoint http://127.0.0.1:45980 [--version 1|2] [--apply]');
const versionArg=args.includes('--version')?args[args.indexOf('--version')+1]:'1';if(versionArg!=='1'&&versionArg!=='2')throw new Error('版本只支持1或2');const version=Number(versionArg) as 1|2,scenarios=version===2?fourRequirementScenariosV2:fourRequirementScenarios;
const endpoint=args[args.indexOf('--endpoint')+1];if(!endpoint)throw new Error('需要明确本机 endpoint');
const url=new URL(endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('仅支持显式本机 Talents origin');
const get=async(path:string)=>{const r=await fetch(url.origin+path);if(!r.ok)throw new Error(`HTTP ${r.status}: ${await r.text()}`);return r.json();};
const health=await get('/api/health');if(health.app!=='talents-carddemo'||health.service!=='talents')throw new Error('端口不是Talents服务，未写入');
const before=await get('/api/bootstrap'),result=appendFourRequirements(before.state,version),output=buildExport(result.state);
for(const s of scenarios){const files=output.files.get(s.artifactId+'/v'+s.version);if(files?.length!==Object.keys(s.files).length+1)throw new Error('发布资料不完整：'+s.businessId);}
if(apply&&result.added.length){
 const response=await fetch(url.origin+'/api/state',{method:'PUT',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({revision:before.revision,state:result.state})});
 if(!response.ok)throw new Error(`追加失败 HTTP ${response.status}: ${await response.text()}`);
 await response.json();const after=await get('/api/bootstrap');
 if(JSON.stringify(after.state.artifacts.filter((a:any)=>!result.added.includes(a.id)))!==JSON.stringify(before.state.artifacts))throw new Error('其他产物发生并发变化，请核查；未回滚或覆盖');
 for(const id of result.added)if(!after.state.artifacts.some((a:any)=>a.id===id))throw new Error('保存后缺少产物：'+id);
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',version,wouldAdd:result.added,added:apply?result.added:[],beforeRevision:before.revision,workspaceRoot:health.workspaceRoot,scenarios:scenarios.map(s=>({businessId:s.businessId,title:s.title,artifactId:s.artifactId,version:s.version,sourceSha256:s.sourceSha256,creationDescription:s.creationDescription})),note:'仅追加输入资料；未创建或推进任务，未运行模型与业务检查。'},null,2));
