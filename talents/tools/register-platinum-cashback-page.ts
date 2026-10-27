/** Add one reviewed scenario artifact through the running Talents API. Dry run unless --apply. */
import { appendPlatinumCashbackPage } from '../server/platinum-cashback-page.ts';
import { platinumCashbackPage } from '../../shared/platinum-cashback-page.ts';
const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.some((arg,index)=>arg!=='--apply'&&arg!=='--endpoint'&&args[index-1]!=='--endpoint'))throw new Error('用法：node --import tsx tools/register-platinum-cashback-page.ts --endpoint http://127.0.0.1:45980 [--apply]');
const endpoint=args[args.indexOf('--endpoint')+1];
if(!args.includes('--endpoint')||!endpoint)throw new Error('需要显式 --endpoint，不隐式选择正式服务');
const url=new URL(endpoint);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('仅支持显式本机 Talents origin');
const get=async(path:string)=>{const response=await fetch(url.origin+path);if(!response.ok)throw new Error(`读取失败 HTTP ${response.status}: ${await response.text()}`);return response.json();};
const health=await get('/api/health');if(health.app!=='talents-carddemo'||health.service!=='talents')throw new Error('所选端口不是 Talents 服务，未写入');
const before=await get('/api/bootstrap'),result=appendPlatinumCashbackPage(before.state);
if(apply&&result.added){
 const response=await fetch(url.origin+'/api/state',{method:'PUT',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({revision:before.revision,state:result.state})});
 if(!response.ok)throw new Error(`追加失败 HTTP ${response.status}: ${await response.text()}`);
 await response.json();
 const after=await get('/api/bootstrap'),desired=after.state.artifacts.find((item:any)=>item.id===platinumCashbackPage.artifactId);
 if(!desired)throw new Error('保存后未找到新增产物，请核查服务日志，勿重置');
 const oldArtifacts=after.state.artifacts.filter((item:any)=>item.id!==platinumCashbackPage.artifactId);
 if(JSON.stringify(oldArtifacts)!==JSON.stringify(before.state.artifacts))throw new Error('检测到其它产物在并发更新，请核查；没有执行回滚或覆盖');
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',added:apply&&result.added,wouldAdd:result.added,artifactId:platinumCashbackPage.artifactId,version:platinumCashbackPage.version,beforeRevision:before.revision,workspaceRoot:health.workspaceRoot,stateRoot:health.stateRoot,note:result.added?'仅追加专用发布产物；不创建需求、不重置状态、不运行模型。':'相同产物已存在，未写入。'},null,2));
