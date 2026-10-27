import { useState } from 'react';
import { Button, Empty, Form, Input, List, Modal, Select, Tag } from 'antd';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { canLinkTaskSession, collectTaskSessions, mainTask, taskAutomation } from '../task-automation.js';
import { projectDeliveryTasks } from '../project-delivery-tasks.js';
export function TaskSessions({ node, readonly = false,scope=mainTask }: { node?: 'develop' | 'verify'; readonly?: boolean; scope?:typeof mainTask }) {
  const { state, role, busy, update } = useDemo();
  const [open,setOpen]=useState(false);const [form]=Form.useForm();
  if (role === 'member' && !projectDeliveryTasks(state, scope.projectId, role).some(task => task.id === scope.taskId)) return null;
  const sessions=collectTaskSessions(state,scope).filter(session=>!node||session.nodeIds.includes(node)),collection=taskAutomation(state,scope)?.collection;
  const canLink=!readonly && !!node && canLinkTaskSession(state,role,scope,node);
  return <FrameworkCard title="任务关联会话" action={<Tag>{sessions.length} 个会话</Tag>}>
    <List size="small" dataSource={sessions} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联本任务会话"/>}} renderItem={item=><List.Item><div><strong>{item.tool} · {item.sessionId}</strong><p className="muted">{item.nodeIds.map(node=>node==='develop'?'功能开发':'测试验证').join(' / ')} · {item.sources.join('、')}</p></div></List.Item>}/>
    {canLink && <Button aria-label="关联工作会话" onClick={()=>{form.resetFields();setOpen(true);}}>关联会话</Button>}
    <p className="muted">开发和验证中可关联多个会话，Teams CLI 携带 sessionId 的进度会自动关联。验收通过后统一去重归集，无需成员再次上报。</p>
    {collection && <p>验收后归集：{collection.reporting?.status==='reported'?(collection.reporting.receipt?.id.startsWith('SHARED-')?'已写入 Talents 共享目录':collection.reporting.receipt?.id.startsWith('TALENT-INBOX-')?'历史 Talent 已接收':'已取得归集回执'):collection.reporting?.status==='failed'?'上报未完成':collection.reporting?.status==='uploading'?'正在写入共享目录':({queued:'等待归集',running:'正在归集',collected:'已归集 · 待共享',empty:'暂无关联会话',failed:'归集未完成'}[collection.status])} · {collection.sessions.length} 个会话{collection.finishedAt?' · '+new Date(collection.finishedAt).toLocaleString('zh-CN'):''}</p>}
    <Modal title="关联当前节点会话" open={open && canLink} onCancel={()=>setOpen(false)} okText="关联" cancelText="取消" confirmLoading={busy} okButtonProps={{'aria-label':'保存会话关联',disabled:busy}} cancelButtonProps={{disabled:busy}} closable={!busy} maskClosable={!busy} onOk={()=>form.submit()}><Form form={form} layout="vertical" initialValues={{tool:'icode',sessionId:''}} disabled={busy} onFinish={async values=>{if(!canLink)return;if(await update('session.link',{...scope,nodeId:node,...values}))setOpen(false);}}><Form.Item name="tool" label="工具"><Select aria-label="会话工具" options={[{value:'icode',label:'iCode'},{value:'opencode',label:'OpenCode'}]}/></Form.Item><Form.Item name="sessionId" label="会话标识" rules={[{required:true,whitespace:true}]}><Input aria-label="关联会话标识" maxLength={200}/></Form.Item></Form><p className="muted">保存已有会话与本任务的关系，不会启动工具、读取会话文件或上传内容。</p></Modal>
  </FrameworkCard>;
}
