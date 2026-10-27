import {DomainError,type DemoState} from '../src/domain.js';
import type {Presentation} from '../src/api.js';
import type {TalentNodeInputs} from '../src/talent-node-inputs.js';
import type {RequirementNode} from '../src/delivery-requirements.js';
import {talentOrigin} from './config.js';
import {talentNodeInputs} from './talent-node-inputs.js';
import {registeredTaskSkill} from './talent-intake.js';
import {projectKnowledge,readTalentsFile} from './shared-data.js';
import {deliveryRequirement} from '../src/delivery-requirements.js';
import {taskAutomation,taskNodeKnowledge} from '../src/task-automation.js';
import {nodePresetVersion} from './talent-node-presets.js';
/** Teams consumes Talents' published shared data. No removed Talent HTTP service is called. */
export async function readTalentNodeInputs(state:DemoState,data:Presentation,scope:{projectId:string;taskId:string;nodeId:RequirementNode},options:{forImport?:boolean}={}):Promise<TalentNodeInputs>{
 const project=scope.projectId==='carddemo'?state.workspace.project:scope.projectId==='teams'?data.teamsProject.project:state.workspace.projects?.find(item=>item.id===scope.projectId);
 if(!project)throw new DomainError('项目不存在',404);
 const task=deliveryRequirement(state,scope.projectId,scope.taskId),automatic=taskAutomation(state,scope);
 const acquisition=scope.nodeId==='accept'?undefined:taskNodeKnowledge(automatic,scope.nodeId);
 if(task&&acquisition&&!task.nodeInputSnapshots?.[scope.nodeId]&&!options.forImport){
  if(acquisition.status!=='ready')return{...scope,generation:state.talentGeneration??'initial',origin:talentOrigin,requirement:{id:task.id,title:task.title,description:task.description},knowledge:{status:'not-built',assets:[]},skills:[],selection:{version:nodePresetVersion,source:'teams-node-selection',status:'not-configured',basis:'recommendation',note:acquisition.error??(acquisition.status==='waiting-upstream'?'当前节点正在等待上游成果。':'当前节点知识尚未获取完成。'),missingSkillIds:[],knowledge:[],skills:[]}};
  if(acquisition.nodeInputs)return structuredClone(acquisition.nodeInputs);
 }
 return talentNodeInputs({state,project:{id:scope.projectId,name:project.name,generation:state.talentGeneration??'initial'}},data,scope.taskId,scope.nodeId,talentOrigin,registeredTaskSkill,await projectKnowledge(scope.projectId),readTalentsFile);
}
