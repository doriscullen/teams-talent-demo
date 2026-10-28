import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Empty, Space, Spin, Tag } from 'antd';
import { getTaskArtifactContent } from '../api.js';
import type { TaskArtifactContent } from '../task-artifact-content.js';
import { useDemo } from '../context.js';
import { taskNodeDefinitions, type TaskNodeItem, type TaskNodeReference, type TaskNodeView } from '../task-node-contract.js';
import type { RequirementNode } from '../delivery-requirements.js';
import './task-node-artifacts.css';

const statusLabels = { ready: '已就绪', missing: '待提交', unregistered: '未登记' };
const kindLabels = { reference: '资料引用', 'local-file': '本地文件引用', record: '已登记记录' };
const artifactLabel = (reference: TaskNodeReference) => Object.values(taskNodeDefinitions).flatMap(node => node.deliverableRequirements).find(item => item.artifact === reference.artifact)?.label ?? kindLabels[reference.kind];
export function TaskNodeArtifacts({ items, onSource, scope }: { items: TaskNodeItem[]; onSource(node: RequirementNode): void; scope?:{projectId:string;taskId:string;nodeId:RequirementNode} }) {
  const { showText,role } = useDemo();
  const [selected,setSelected]=useState<TaskNodeReference|null>(null),[body,setBody]=useState<TaskArtifactContent|null>(null),[error,setError]=useState('');
  const [selectionScope,setSelectionScope]=useState('');
  const request=useRef(0),scopeKey=JSON.stringify([role,scope?.projectId,scope?.taskId,scope?.nodeId]);
  const activeScope=useRef(scopeKey);activeScope.current=scopeKey;
  useEffect(()=>{request.current++;setSelected(null);setBody(null);setError('');return()=>{request.current++;};},[scopeKey]);

  const details = (reference: TaskNodeReference) => [reference.title, '', '类型：' + artifactLabel(reference), '来源：' + reference.sourceLabel, '版本：' + (reference.version ?? '未登记'), ...(reference.codeVersion ? ['代码版本：' + reference.codeVersion] : []), ...(reference.value ? ['引用：' + reference.value] : []), '', reference.description, ...(reference.execution ? ['', '单元测试执行声明（调用者回传，服务端未独立执行核验）', '必要范围：' + reference.execution.requiredScopes.join('、'), '未执行范围：' + (reference.execution.notRunScopes.join('、') || '无'), ...reference.execution.runs.flatMap(run => ['', '范围：' + run.scope, '命令：' + run.command, '状态：' + run.status + '；退出码：' + (run.exitCode ?? '未执行'), `通过 ${run.passed} / 失败 ${run.failed} / 跳过 ${run.skipped}`, '执行时间：' + (run.executedAt ?? '未登记'), ...(run.excludedSkips ? [`明确非必需的跳过项：${run.excludedSkips.count}；原因：${run.excludedSkips.reason}`] : [])])] : reference.artifact === 'unit-test-result' ? ['', '此历史报告未登记结构化执行声明，执行情况待核对。'] : [])].join('\n');
  const open = (reference: TaskNodeReference) => {
    if(!scope||!reference.id.startsWith('artifact:')||!reference.sourceNode){showText(reference.title, details(reference));return;}
    const id=++request.current,key=scopeKey;setSelectionScope(key);setSelected(reference);setBody(null);setError('');
    void getTaskArtifactContent(role,{projectId:scope.projectId,taskId:scope.taskId,nodeId:reference.sourceNode,artifactId:reference.id,version:reference.version??''}).then(value=>{if(request.current===id&&activeScope.current===key)setBody(value);}).catch(reason=>{if(request.current===id&&activeScope.current===key)setError((reason as Error).message);});
  };

  return <><div className="task-artifact-grid">{items.map(item => <section className="task-artifact-group" key={item.id} data-artifact-slot={item.id} data-artifact-status={item.status}>
    <div className="task-artifact-heading"><strong>{item.label}</strong><Tag>{statusLabels[item.status]}</Tag></div>
    {item.references.length ? item.references.slice(0, 2).map(reference => <div className="task-artifact-reference" key={reference.id} data-artifact-reference={reference.id}>
      <span className="task-artifact-name" title={reference.title}>{reference.title}</span>
      <p className="task-artifact-meta" title={reference.sourceLabel + ' · ' + (reference.version ?? '未登记版本')}>{reference.sourceLabel}{reference.version ? ' · ' + reference.version : ' · 版本未登记'}</p>
      {reference.codeVersion && <p className="task-artifact-meta" title={reference.codeVersion}>代码版本 · {reference.codeVersion}</p>}
      <Space size={8} wrap><Button type="link" size="small" onClick={() => open(reference)}>查看引用</Button>{reference.sourceNode && <Button type="link" size="small" onClick={() => onSource(reference.sourceNode!)}>来源：{taskNodeDefinitions[reference.sourceNode].label}</Button>}</Space>
    </div>) : <p className="task-artifact-missing">{item.status === 'unregistered' ? '现有记录未登记此项产物或输入。' : '等待提交可追踪的资料与版本。'}</p>}
    {item.references.length > 2 && <Button type="link" size="small" className="task-artifact-more" onClick={() => showText(item.label + ' · 全部引用', item.references.map(details).join('\n\n'))}>查看全部 {item.references.length} 项</Button>}
  </section>)}</div><Drawer open={!!selected&&selectionScope===scopeKey} onClose={()=>{request.current++;setSelected(null);}} title={selected?artifactLabel(selected):undefined} width={880} destroyOnHidden>
    <div data-task-artifact-viewer={selected?.id} data-artifact-task={scope?.taskId}>
      {selected?.version&&<p>版本：{selected.version}</p>}
      {error?<Alert type="error" showIcon title="产物读取失败" description={error}/>:body?body.kind==='link'?<Button type="link" href={body.url} target="_blank" rel="noopener noreferrer">打开 GitHub PR／提交</Button>:<pre className="task-node-fulltext" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{body.content}</pre>:<Spin size="small"/>}
      {body&&<Collapse size="small" items={[{key:'metadata',label:'引用与版本信息',children:<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{[selected?details(selected):'',body.note,body.sha256?'当前正文 SHA256：'+body.sha256:''].filter(Boolean).join('\n\n')}</pre>}]}/>}
    </div>
  </Drawer></>;
}
export function TaskCompletionCriteria({ view }: { view: TaskNodeView }) {
  const { showText } = useDemo();
  return <section className="task-completion-criteria"><h3>完成标准</h3>{view.criteria.length ? view.criteria.map(item => <div key={item.id} data-completion-criterion={item.id} data-criterion-status={item.status}>
    <div><Tag>{item.status === 'reported' ? view.definition.id === 'accept' ? 'Owner 已确认' : '成员回传' : item.status === 'unregistered' ? '依据未登记' : '待完成'}</Tag><span>{item.label}</span></div>
    {item.evidenceIds.length > 0 && <Button type="link" size="small" onClick={() => showText(item.label + ' · 对应依据', JSON.stringify({ criterion: item, references: [...view.artifacts, ...view.deliverables.flatMap(slot => slot.references)].filter(reference => item.evidenceIds.includes(reference.id)) }, null, 2))}>查看对应依据</Button>}
  </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未登记完成标准" />}<p className="muted">标准状态以本任务的明确回传或 Owner 确认为准；资料引用的正文与实际执行结论仍需核对。</p></section>;
}
export function nodeArtifactSummary(view: TaskNodeView) {
  const displayed = view.deliverables.filter(item => view.definition.deliverableRequirements.some(required => required.id === item.id));
  return '交付物 ' + displayed.filter(item => item.status === 'ready').length + '/' + displayed.length;
}
