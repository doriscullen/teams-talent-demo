import type { Presentation } from './api.js';
import type { RequirementNode } from './delivery-requirements.js';

export type ImportedTask = Presentation['teamsProject']['tasks'][number];
export type ImportedNode = ImportedTask['nodes'][number];
export const importedNodeStages: Record<string, RequirementNode> = { clarify: 'prepare', design: 'prepare', review: 'prepare', build: 'develop', research: 'develop', proposal: 'develop', prep: 'verify', test: 'verify', accept: 'accept' };
export const deliveryStages: RequirementNode[] = ['prepare', 'develop', 'verify', 'accept'];
export function importedStage(task: ImportedTask, id: RequirementNode) {
  const nodes = task.nodes.filter(node => importedNodeStages[node.id] === id);
  const primary = id === 'verify' ? nodes.find(node => node.id === 'test') : nodes.at(-1);
  return { id, nodes, primary, status: primary?.status ?? (nodes.length ? '仅有测试准备' : '来源未提供'), owner: primary?.owner ?? '未提供', outputs: nodes.filter(node => node.output.trim() && node.output !== '—') };
}
export function importedSelectedStage(task: ImportedTask, requested?: string | null, sourceSelected?: string): RequirementNode | undefined {
  if (requested) return deliveryStages.includes(requested as RequirementNode) ? requested as RequirementNode : task.nodes.some(node => node.id === requested) ? importedNodeStages[requested] : undefined;
  if (sourceSelected && task.nodes.some(node => node.id === sourceSelected)) return importedNodeStages[sourceSelected];
  if (task.status === '已验收' || task.status === '待验收') return 'accept';
  const pending = task.nodes.find(node => !['已完成', '已确认', '已提交', '已形成场景'].includes(node.status));
  return pending ? importedNodeStages[pending.id] : 'prepare';
}

// Source records can be read, but names such as “澄清结论” do not establish a PRD/report contract.
import type {TalentNodeInputs} from './talent-node-inputs.js';
import { applyTalentNodeInputs, enterpriseTestCaseReferences, taskNodeDefinitions, type TaskNodeReference, type TaskNodeView } from './task-node-contract.js';
export function importedTaskNodeView(task: ImportedTask, node: RequirementNode, nodeInputs?:TalentNodeInputs|null, data?:Presentation): TaskNodeView {
  const definition = taskNodeDefinitions[node];
  const requirement: TaskNodeReference = { id: 'source:teams:' + task.id + ':requirement', title: task.title, kind: 'record', description: [task.goal, '范围：' + task.scope, ...task.criteria].join('\n'), version: task.version, source: 'legacy', sourceLabel: '原 Teams 任务记录' };
  const artifacts: TaskNodeReference[] = task.nodes.filter(item => item.output && item.output !== '—').map(item => ({ id: 'source:teams:' + task.id + ':' + item.id, title: item.output, kind: 'record', description: item.brief, value: JSON.stringify(item, null, 2), version: task.version, source: 'legacy', sourceNode: importedNodeStages[item.id], sourceLabel: '原节点 · ' + item.name }));
  const inputs: TaskNodeView['inputs'] = definition.inputRequirements.map(item => ({ ...item, status: item.id === 'requirement' ? 'ready' : 'unregistered', references: item.id === 'requirement' ? [requirement] : [] }));
  if(node==='verify'&&data){const slot=inputs.find(item=>item.id==='test-cases');if(slot){slot.references=enterpriseTestCaseReferences(data,{...task,projectId:'teams'});if(slot.references.length)slot.status='ready';}}
  applyTalentNodeInputs(inputs,nodeInputs);
  if (node !== 'prepare') inputs.push({ id: 'source-requirement', label: '原始任务资料', status: 'ready', references: [requirement] });
  const upstream = artifacts.filter(item => deliveryStages.indexOf(item.sourceNode!) < deliveryStages.indexOf(node));
  if (upstream.length) inputs.push({ id: 'source-upstream', label: '原流程上游记录', status: 'ready', references: upstream });
  const deliverables: TaskNodeView['deliverables'] = definition.deliverableRequirements.map(item => ({ ...item, status: 'unregistered', references: [] }));
  const own = artifacts.filter(item => item.sourceNode === node);
  if (own.length) deliverables.push({ id: 'source-output', label: '原流程成果记录', status: 'ready', references: own });
  return { definition, inputs, deliverables, criteria: definition.completionCriteria.map(item => ({ ...item, status: 'unregistered', evidenceIds: [] })), artifacts };
}
