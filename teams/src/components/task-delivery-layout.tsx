import type { ReactNode } from 'react';
import { Tag } from 'antd';
import type { RequirementNode } from '../delivery-requirements.js';
import { displayRequirementId } from '../display-text.js';
import { taskNodeDefinitions } from '../task-node-contract.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import './live-task-delivery.css';

export const deliveryNodeLabels = Object.fromEntries(Object.values(taskNodeDefinitions).map(node => [node.id, node.label])) as Record<RequirementNode, string>;
type Section = { content: ReactNode; action?: ReactNode };
/** One presentation shell for live delivery and explicitly read-only source records. */
export function TaskDeliveryLayout({ projectId, taskId, title, owner, node, nodeOwner, contentKey, sidebar, flow, sections, materials, children }: {
  projectId: string; taskId: string; title: string; owner: string; node: RequirementNode; nodeOwner: string; contentKey: string;
  sidebar: ReactNode; flow: ReactNode; sections: Record<'input' | 'execution' | 'result', Section>; materials: ReactNode; children?: ReactNode;
}) {
  return <div className="project-delivery-layout unified-task-delivery" data-delivery-scope={projectId + '/' + taskId}>
    {sidebar}
    <main className="project-node-main">
      <div className="project-flow-heading"><strong>{title}</strong><Tag title={displayRequirementId(taskId)}>{displayRequirementId(taskId)}</Tag></div>
      {flow}
      <div className="project-node-heading"><h2>{deliveryNodeLabels[node]}</h2><Tag>{nodeOwner}</Tag></div>
      <div className="page-stack project-node-content task-node-sections" key={contentKey}>
        {(['input', 'result', 'execution'] as const).map((id, index) => <div key={id} data-node-section={id}><FrameworkCard title={['输入', '结果', '执行过程'][index]} action={sections[id].action}>{sections[id].content}</FrameworkCard></div>)}
      </div>
    </main>
    <aside className="task-permanent-materials" aria-label="任务资料" data-material-task={taskId} data-material-project={projectId}>
      <h3>任务资料</h3><strong className="task-material-title">{title}</strong><p className="muted">{displayRequirementId(taskId)} · 交付人 {owner}</p>{materials}
    </aside>
    {children}
  </div>;
}
