import { useState } from 'react';
import { Button, Descriptions, Drawer, Space, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import type { DeliveryRequirement, RequirementNode } from '../delivery-requirements.js';
import { TaskSessions } from './task-sessions.js';
import { CollaborationProgress } from './collaboration-progress.js';
import { useDemo } from '../context.js';
import { taskVisibleTo } from '../task-visibility.js';

const labels: Record<RequirementNode, string> = { prepare: '需求澄清', develop: '功能开发', verify: '测试验证', accept: '需求验收' };
const statuses = { pending: '待开始', running: '进行中', blocked: '阻塞', complete: '已完成', 'waiting-owner': '待 Owner 验收' };

/** A read-only view of this delivery instance, with no historical-project trace fallback. */
export function TaskExecutionRecords({ task }: { task: DeliveryRequirement }) {
  const [open, setOpen] = useState(false);
  const { role } = useDemo();
  if (!taskVisibleTo(role, task.assigneeId)) return null;
  const scope = { projectId: task.projectId, taskId: task.id };
  return <>
    <Button type="text" icon={<FileTextOutlined />} aria-label="查看需求执行记录" title="查看需求执行记录" onClick={() => setOpen(true)}><span className="project-secondary-action-label">执行记录</span></Button>
    <Drawer title={task.id + ' · 执行记录'} width={760} open={open} onClose={() => setOpen(false)} destroyOnHidden>
      <div className="page-stack" data-execution-task={task.id} data-execution-project={task.projectId}>
        <h3>{task.title}</h3>
        <Descriptions size="small" column={1} items={(Object.keys(labels) as RequirementNode[]).map(node => ({ key: node, label: labels[node], children: <div style={{ minWidth: 0 }}><Space wrap><Tag>{statuses[task.nodes[node].status]}</Tag>{task.nodes[node].updatedAt && <span className="muted">{new Date(task.nodes[node].updatedAt).toLocaleString('zh-CN')}</span>}</Space><p>{task.nodes[node].summary || '尚无此节点的执行记录。'}</p></div> }))} />
        <TaskSessions scope={scope} readonly />
        <CollaborationProgress {...scope} />
      </div>
    </Drawer>
  </>;
}
