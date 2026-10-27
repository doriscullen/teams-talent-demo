import { isDeepStrictEqual } from 'node:util';
import type { Artifact } from './model.ts';
import { platinumCashbackPage } from '../../shared/platinum-cashback-page.ts';
/** Additive scenario material only; no run, mining result or seed-version migration is fabricated. */
export function platinumCashbackPageArtifact(): Artifact {
 const files=[...Object.values(platinumCashbackPage.files),platinumCashbackPage.manifest];
 return {id:platinumCashbackPage.artifactId,projectId:platinumCashbackPage.projectId,cap:'doc-extract',name:'白金卡消费返现权益说明页知识',desc:'权益展示边界、待确认清单、已核实静态 Web 模块与待执行验收用例。',sources:['docset:carddemo','repository:carddemo:carddemo-java-1025'],kind:'files',folder:'platinum-cashback-page',files,usage:'用于同名权益说明页需求的澄清、开发、验证与验收；任务实际说明及采用记录独立保存。',
  scenario:{id:platinumCashbackPage.id,projectId:platinumCashbackPage.projectId,exactTitle:platinumCashbackPage.title,origin:'scenario-fixture',provenance:platinumCashbackPage.manifest},
  published:{version:1,at:'2026-10-27 21:00',note:'登记权益说明资料与源码核验依据；不代表需求已采用、开发或验收。',delivery:'local',files,basis:{version:platinumCashbackPage.id}},draft:null};
}
/** Existing data is never replaced. Same artifact is idempotent; ID collisions require explicit review. */
export function appendPlatinumCashbackPage<T extends {artifacts:Artifact[];capabilities:Array<{id:string}>}>(state:T):{state:T;added:boolean}{
 const desired=platinumCashbackPageArtifact(),existing=state.artifacts.find(item=>item.id===desired.id);
 if(existing){if(!isDeepStrictEqual(existing,desired))throw new Error('同 ID 的权益说明产物已存在且内容不同；未覆盖，请人工核对版本。');return{state,added:false};}
 if(!state.capabilities.some(item=>item.id==='doc-extract'))throw new Error('缺少已登记的 doc-extract 能力；未擅自创建替代能力。');
 return{state:{...state,artifacts:[...state.artifacts,desired]},added:true};
}
