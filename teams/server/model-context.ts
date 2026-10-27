import type { collaborationContext } from './collaboration-service.js';
import type { TaskNodeReference } from '../src/task-node-contract.js';

type FullContext = Awaited<ReturnType<typeof collaborationContext>>;
type FullNodeContract = NonNullable<FullContext['nodeContract']>;
/** A JSON pointer addresses a full body already present in this same document. */
export type ModelReference = Omit<TaskNodeReference,'description'> & {description?:string;contentRef?:string};
type ModelNodeItem = Omit<FullNodeContract['inputs'][number],'references'> & {references:ModelReference[]};
export type ModelTaskContext = Omit<FullContext,'talentInputs'|'nodeInputs'|'automaticPreparation'|'nodeContract'|'adoptedBasis'|'events'|'node'> & {
 view:'model'; projection:{version:'model-context-v1';bodyLocation:string;fullView:'full'};
 node: FullContext['node'];
 nodeInputs: null | {projectId:string;taskId:string;nodeId:string;generation:string;origin:string;selection:NonNullable<FullContext['nodeInputs']>['selection'];knowledgeIds:string[];skillIds:string[]};
 nodeContract: null | Omit<FullNodeContract,'inputs'|'deliverables'|'artifacts'> & {inputs:ModelNodeItem[];deliverables:ModelNodeItem[];artifacts:ModelReference[]};
 automaticPreparation:null|{id:string;nodeId?:string;status:string;attempts:number;startedAt:string;finishedAt:string|null;queuedAt?:string;delayMs?:number;error?:string};
 history:{eventCount:number;adoptionCount:number;latestEvent:FullContext['events'][number]|null;latestAdoption:FullContext['adoptedBasis'][number]|null};
};

/**
 * Read-only model view. The original authoritative digest/revision are copied, not
 * recomputed from the display. Persisted inputs, exported old files and history
 * are never mutated. No body is truncated, paraphrased or fetched from elsewhere.
 */
export function projectModelContext(full:FullContext):ModelTaskContext {
 const value=structuredClone(full);
 const {talentInputs:_talentInputs,nodeInputs,automaticPreparation,nodeContract,adoptedBasis,events,node,...rest}=value;
 const bodies=new Map<string,{body:string;pointer:string}>();
 const agreement=value.agreement;
 if('background' in agreement&&typeof agreement.background==='string'&&value.scope.taskId){
  bodies.set('requirement:'+value.scope.projectId+':'+value.scope.taskId,{body:agreement.background,pointer:'#/agreement/background'});
 }
 value.knowledge.assets.forEach((asset,index)=>{
  if(asset&&typeof asset==='object'&&'id' in asset&&typeof asset.id==='string'&&'detail' in asset&&typeof asset.detail==='string')bodies.set(asset.id,{body:asset.detail,pointer:'#/knowledge/assets/'+index+'/detail'});
 });
 const projectReference=(reference:TaskNodeReference):ModelReference=>{
  const body=bodies.get(reference.id);
  if(!body||!body.body)return reference;
  if(reference.description===body.body){const {description:_description,...metadata}=reference;return{...metadata,contentRef:body.pointer};}
  const prefix=body.body+'\n关联理由：';
  if(reference.description.startsWith(prefix))return{...reference,description:reference.description.slice(body.body.length+1),contentRef:body.pointer};
  // Same ID with different prose is not interchangeable; retain it verbatim.
  return reference;
 };
 const represented=new Set(nodeContract?[...nodeContract.inputs,...nodeContract.deliverables].flatMap(item=>item.references.map(reference=>reference.id)):[]);
 const latestEvent=events.at(-1)??null,latestAdoption=adoptedBasis.at(-1)??null;
 return {
  ...rest,view:'model',projection:{version:'model-context-v1',bodyLocation:'Read Skill bodies from skills[].content and knowledge bodies from knowledge.assets[].detail once. contentRef is an in-document JSON pointer; referenced bodies are complete. Historical activity is summarized; request view=full for all records.',fullView:'full'},
  node,
  nodeInputs:nodeInputs?{projectId:nodeInputs.projectId,taskId:nodeInputs.taskId,nodeId:nodeInputs.nodeId,generation:nodeInputs.generation,origin:nodeInputs.origin,selection:nodeInputs.selection,knowledgeIds:nodeInputs.knowledge.assets.map(asset=>asset.id),skillIds:nodeInputs.skills.map(skill=>skill.id)}:null,
  nodeContract:nodeContract?{...nodeContract,inputs:nodeContract.inputs.map(item=>({...item,references:item.references.map(projectReference)})),deliverables:nodeContract.deliverables.map(item=>({...item,references:item.references.map(projectReference)})),artifacts:nodeContract.artifacts.filter(reference=>!represented.has(reference.id)).map(projectReference)}:null,
  automaticPreparation:automaticPreparation?{id:automaticPreparation.id,...(automaticPreparation.nodeId?{nodeId:automaticPreparation.nodeId}:{}),status:automaticPreparation.status,attempts:automaticPreparation.attempts,startedAt:automaticPreparation.startedAt,finishedAt:automaticPreparation.finishedAt,...(automaticPreparation.queuedAt?{queuedAt:automaticPreparation.queuedAt}:{}),...(automaticPreparation.delayMs!==undefined?{delayMs:automaticPreparation.delayMs}:{}),...(automaticPreparation.error?{error:automaticPreparation.error}:{})}:null,
  history:{eventCount:events.length,adoptionCount:adoptedBasis.length,latestEvent,latestAdoption},
 };
}
