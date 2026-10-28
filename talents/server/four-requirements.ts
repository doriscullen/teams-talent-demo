import { isDeepStrictEqual } from 'node:util';
import type { Artifact } from './model.ts';
import { fourRequirementScenarios, fourRequirementScenariosV2 } from '../../shared/four-requirement-scenarios.ts';

/** Explicit, additive source registration; no task, adoption, test or mining result is created. */
export function fourRequirementArtifacts(version:1|2=1): Artifact[] {
 return (version===2?fourRequirementScenariosV2:fourRequirementScenarios).map(s=>({id:s.artifactId,cap:'doc-extract',name:s.businessId+' · '+s.title+'节点资料',desc:'完整原始需求、规则、差异清单、基线事实与待执行测试定义。',sources:['docset:carddemo','repository:carddemo:carddemo-java-1025'],kind:'files',folder:'four-requirements/'+s.businessId,files:[...Object.values(s.files),s.manifest],usage:'精确业务需求与原文摘要匹配后，按节点选择。提供输入，不代表已采用、工具已执行或验收。',scenario:{id:s.id,projectId:s.projectId,businessId:s.businessId,exactTitle:s.title,sourceSha256:s.sourceSha256,origin:'scenario-fixture',provenance:s.manifest},published:{version:s.version,at:version===2?'2026-10-28 02:14':'2026-10-28 01:33',note:'登记用户提供的需求与测试资料；原文模拟属性及待确认事项保留。',delivery:'local',project:s.projectId,files:[...Object.values(s.files),s.manifest],basis:{version:s.id}},draft:null}));
}
export function appendFourRequirements<T extends {artifacts:Artifact[];capabilities:Array<{id:string}>}>(state:T,version:1|2=1):{state:T;added:string[]} {
 if(!state.capabilities.some(c=>c.id==='doc-extract'))throw new Error('缺少已登记的 doc-extract 能力，未写入');
 const additions:Artifact[]=[];
 for(const desired of fourRequirementArtifacts(version)){
  const existing=state.artifacts.filter(a=>a.id===desired.id);
  if(existing.length>1||existing.length===1&&!isDeepStrictEqual(existing[0],desired))throw new Error('同 ID 场景产物内容不同，请核对版本：'+desired.id);
  if(!existing.length)additions.push(desired);
 }
 return {state:additions.length?{...state,artifacts:[...state.artifacts,...additions]}:state,added:additions.map(a=>a.id)};
}
