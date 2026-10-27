import { projectMembers, projectTeam } from '../teams-domain.js';
import { ProjectTaskManagement } from '../components/project-task-management.js';
import { displayProjectDescription } from '../display-text.js';
import { useEffect, useState } from 'react';
import { getTalentsKnowledge, type TalentsSkillVersion } from '../api.js';
import { Button, Descriptions, Form, Input, Modal, Space, Tabs, Tag } from 'antd';
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { ActionButton, Mono, Origin } from '../components/common.js';
import { stageLabels } from '../domain.js';
import { ProjectContentTemplate } from '../components/project-content-template.js';
import { ProjectAssets } from '../components/project-assets.js';
import { ProjectKnowledge } from '../components/project-knowledge.js';

export function ProjectContent() {
  const { state, data, role, navigate } = useDemo();
  // Project skills Talents wrote a new version of (applying a trajectory diagnosis suggestion) show that version.
  const [talentsSkills, setTalentsSkills] = useState<TalentsSkillVersion[]>([]);
  useEffect(() => { let live = true; getTalentsKnowledge('carddemo').then(value => { if (live) setTalentsSkills(value.skills ?? []); }, () => undefined); return () => { live = false; }; }, [state.revision]);
  return <ProjectContentTemplate projectId="carddemo" name={state.workspace.project.name} description={displayProjectDescription(state.workspace.project.description)} origin={<Origin kind="simulated" />}
    information={[
      { key: 'team', label: '所属团队', children: projectTeam(state, 'carddemo').name }, { key: 'owner', label: '项目 Owner', children: '林悦' },
      { key: 'repository', label: '主仓', span: 2, children: <Mono>{state.workspace.project.repository}</Mono> },
      { key: 'directory', label: '本机目录', span: 2, children: 'carddemo-java-1025 · 通过顶部 iCode 作业入口核验本机路径' },
    ]}
    members={<><Descriptions size="small" column={1} items={[{ key: 'owner', label: '林悦 · 项目 Owner', children: '项目资产与知识、需求分配、质量能力、验收及演进' }, { key: 'member', label: (projectMembers(state, 'carddemo').filter(member => member.status === 'active' && member.role === 'member').map(member => member.name).join('、') || '尚无成员') + ' · 项目成员', children: '需求上下文、开发、验证、交付与会话关联' }]} /><Button onClick={() => navigate('team?team=' + projectTeam(state, 'carddemo').id)}>查看团队成员</Button></>}
    assets={<ProjectAssets projectId="carddemo" />}
    knowledge={<ProjectKnowledge projectId="carddemo" />}
    requirements={<><RequirementMaterials /><div className="card-actions"><Button type="primary" onClick={() => navigate('projects?tab=delivery&node=prepare')}>进入需求准备</Button></div></>}
    skills={data.skills.filter(skill => data.blueprint.skill_groups.some(group => group.skills.includes(skill.name))).map(skill => {
      const base = { ...skill, source: '项目采用的导入素材', displayPath: skill.path.slice(skill.path.indexOf('/workspace/') + 1), content: data.skillContents[skill.name] };
      const written = talentsSkills.find(version => version.skillId === skill.name);
      return written ? { ...base, version: written.version, source: `Talents 轨迹诊断改进 · 基于 ${written.basedOn.version} · ${written.note}`, content: written.files.find(file => file.path === 'SKILL.md')?.content ?? base.content } : base;
    })}
    skillFooter={<div className="project-skill-context"><div><strong>本次交付配置</strong><p>前端 Skill {state.adoptedSkill} · Code Agent {state.adoptedAgent} · Review / 测试 / 安全扫描分别保留依据</p><Tag color="green">项目内可用</Tag></div><Space wrap><Button type="primary" onClick={() => navigate('projects?tab=delivery&node=prepare')}>在需求准备中选用</Button><Button onClick={() => navigate('resources')}>查看共享能力</Button>{role === 'owner' && <Button onClick={() => navigate('connections?tab=quality')}>维护质量能力</Button>}</Space></div>}
  />;
}

export function RequirementMaterials() {
  const { state, role, update, busy, showText, showEvidence } = useDemo();
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm();
  return <><div className="project-material-list"><div className="project-material"><FileTextOutlined /><div><strong>白金卡消费返现需求</strong><small>需求材料 · E1</small></div><Button size="small" onClick={() => showEvidence('E1')}>查看</Button></div>
    {state.workspace.materials.map(material => <div className="project-material" key={material.id}><FileTextOutlined /><div><strong>{material.title}</strong><small>成员补充 · 本次需求</small></div><Button size="small" onClick={() => showText(material.title, material.body)}>查看</Button></div>)}</div>
    {role === 'member' && <Button className="project-material-add" icon={<PlusOutlined />} disabled={!!state.context} onClick={() => setAdding(true)}>补充需求材料</Button>}
    {state.context && <p className="muted">本次上下文已冻结，材料与业务 Skill 保留采用时的版本。</p>}
    <Modal open={adding} title="补充需求材料" okText="保存到需求" onCancel={() => setAdding(false)} confirmLoading={busy} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={async value => { const saved = await update('material.add', value); if (saved) { form.resetFields(); setAdding(false); } }}>
        <Form.Item name="title" label="材料标题" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} placeholder="例如：白金卡返现周期说明" /></Form.Item>
        <Form.Item name="body" label="内容与来源" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={6} maxLength={5000} placeholder="说明本需求的业务规则、补充资料或来源引用" /></Form.Item>
      </Form>
    </Modal>
  </>;
}

export function ProjectManagement() { return <ProjectTaskManagement projectId="carddemo" />; }

export function ProjectRelease() {
  const { state, navigate } = useDemo();
  return <div className="page-stack"><FrameworkCard title="信用卡营销 · v0.1" action={<Tag color={state.stage === 'accepted' ? 'green' : 'gold'}>{state.stage === 'accepted' ? '功能交付已确认' : '交付准备中'}</Tag>}><Descriptions column={1} items={[{ key: 'scope', label: '版本范围', children: '信用卡消费返现 · MKT-001' }, { key: 'result', label: '交付状态', children: stageLabels[state.stage] }, { key: 'safety', label: '安全要求', children: <Tag color="gold">待验证</Tag> }, { key: 'release', label: '发布事实', children: '当前未登记部署或上线记录' }]} /><p>本页汇总当前版本的交付范围、验收记录与发布状态。</p><Space wrap><Button type="primary" onClick={() => navigate('projects?tab=delivery&node=accept')}>查看交付与验收</Button><Button onClick={() => navigate('trace')}>查看完整追溯</Button></Space></FrameworkCard></div>;
}

export function ProjectSettings() {
  const { state, role, update, busy, navigate } = useDemo();
  return <div className="page-stack"><FrameworkCard title="项目基础信息"><Form key={state.workspace.project.name + state.workspace.project.repository} layout="vertical" initialValues={{ ...state.workspace.project, description: displayProjectDescription(state.workspace.project.description) }} disabled={role !== 'owner'} onFinish={value => update('project.update', value)}>
    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item><Form.Item name="description" label="项目说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={1000} /></Form.Item><Form.Item name="repository" label="主仓地址或路径" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>{role === 'owner' && <Button type="primary" htmlType="submit" loading={busy}>保存项目信息</Button>}
  </Form></FrameworkCard><FrameworkCard title="项目成员与职责" action={<Origin kind="simulated" />}><Descriptions size="small" items={[{ key: 'team', label: '所属团队', children: projectTeam(state, 'carddemo').name }, { key: 'stage', label: '项目阶段', children: stageLabels[state.stage] }]} /><Descriptions bordered column={1} items={[{ key: 'owner', label: '林悦 · 项目 Owner', children: '项目资产与知识、需求分配、质量能力、验收及演进' }, { key: 'member', label: (projectMembers(state, 'carddemo').filter(member => member.status === 'active' && member.role === 'member').map(member => member.name).join('、') || '尚无成员') + ' · 项目成员', children: '需求上下文、开发、验证、交付与会话关联' }]} /><Button onClick={() => navigate('team?team=' + projectTeam(state, 'carddemo').id)}>查看团队成员</Button></FrameworkCard></div>;
}
