import { Alert } from 'antd';
import { useDemo } from '../context.js';
import { deliveryRequirement, type RequirementNode } from '../delivery-requirements.js';
import { LiveTaskDelivery } from '../components/live-task-delivery.js';
export { deliveryNodeLabels as nodeLabels } from '../components/live-task-delivery.js';
export type DeliveryNode = RequirementNode;

/** The original requirement uses the same persisted delivery instance as every new task. */
export function ProjectDelivery({ node }: { node: DeliveryNode }) {
  const { state, role } = useDemo();
  const task = deliveryRequirement(state, 'carddemo', 'DEMO-MKT-001');
  return task
    ? <LiveTaskDelivery key={task.projectId + ':' + task.id + ':' + role} task={task} node={node} />
    : <Alert type="info" title="当前需求记录尚未就绪" description="请重新读取工作区后查看交付流程。" />;
}
