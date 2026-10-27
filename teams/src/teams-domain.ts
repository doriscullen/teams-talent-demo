import { DomainError, type DemoState, type Role } from './domain.js';

export interface TeamMember { id: string; name: string; role: Role; status: 'active' | 'invited' }
export interface TeamRecord { id: string; name: string; members: TeamMember[]; createdAt?: string }
export type TeamAction = 'team.create' | 'team.update' | 'team.project.assign' | 'member.invite' | 'member.approve' | 'member.role' | 'member.remove';
export const defaultTeamId = 'carddemo';
const teamIdPattern = /^team-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const need: (ok: unknown, message: string, status?: number) => asserts ok = (ok, message, status = 400) => { if (!ok) throw new DomainError(message, status); };
const clean = (value: unknown, label: string, max: number) => { need(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), label + '不能为空或格式无效'); return value.trim(); };
export const teamName = (value: unknown) => clean(value, '团队名称', 80);
const folded = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
/** The original single team remains authoritative. Absent extra teams means the old schema, not a rewrite. */
export function allTeams(state: DemoState): TeamRecord[] { return [{ ...state.workspace.team, id: defaultTeamId }, ...(state.workspace.teams ?? [])]; }
export function findTeam(state: DemoState, teamId: string): TeamRecord { const team = allTeams(state).find(item => item.id === teamId); need(team, '团队不存在'); return team; }
export function projectTeam(state: DemoState, projectId: string): TeamRecord {
  if (projectId === 'carddemo') return findTeam(state, state.workspace.projectTeamId ?? defaultTeamId);
  const project = state.workspace.projects?.find(item => item.id === projectId); need(project, '该项目没有可修改的本地团队归属'); return findTeam(state, project.teamId);
}
/** New local work in the imported project uses local identities; source A/B/C remain unmodified. */
export const projectMembers = (state: DemoState, projectId: string) => projectId === 'teams' ? state.workspace.team.members.filter(member => member.id === 'owner' || member.id === 'member') : projectTeam(state, projectId).members;
export const visibleTeams = (state: DemoState, role: Role) => allTeams(state).filter(team => team.members.some(member => member.id === role && member.status === 'active'));
export function requireTeamOwner(state: DemoState, role: Role, teamId: string) { const team = findTeam(state, teamId); need(role === 'owner' && team.members.some(member => member.id === role && member.role === 'owner' && member.status === 'active'), '当前角色无权管理此团队', 403); return team; }
export function teamProjects(state: DemoState) {
  return [{ id: 'carddemo', name: state.workspace.project.name, description: state.workspace.project.description, teamId: projectTeam(state, 'carddemo').id }, ...(state.workspace.projects ?? []).map(project => ({ id: project.id, name: project.name, description: project.description, teamId: project.teamId }))];
}
function assignedIds(state: DemoState, projectId: string) {
  const ids = (state.workspace.genericTasks ?? []).filter(task => task.projectId === projectId && task.assigneeId).map(task => task.assigneeId!);
  ids.push(...(state.workspace.projectIssues??[]).filter(issue=>issue.projectId===projectId&&issue.assigneeId).map(issue=>issue.assigneeId));
  ids.push(...(state.workspace.deliveryRequirements ?? []).filter(task => task.projectId === projectId && task.assigneeId).map(task => task.assigneeId));
  if (projectId === 'carddemo' && state.assigned && !state.workspace.deliveryRequirements?.some(task=>task.projectId===projectId&&task.id==='DEMO-MKT-001')) ids.push(state.assigneeId === undefined ? 'member' : state.assigneeId!);
  return new Set(ids);
}
export function updateTeam(state: DemoState, role: Role, action: TeamAction, input: Record<string, unknown>, at: string) {
  need(role === 'owner', '当前角色无权执行此操作', 403);
  if (action === 'team.create') {
    const id = clean(input.id, '团队标识', 100), name = teamName(input.name);
    need(teamIdPattern.test(id) && !allTeams(state).some(team => team.id === id), '团队标识无效或已存在');
    need(!allTeams(state).some(team => folded(team.name) === folded(name)), '团队名称已存在'); need(allTeams(state).length < 30, '团队数量已达上限');
    const creator = state.workspace.team.members.find(member => member.id === role); need(creator && creator.status === 'active' && creator.role === 'owner', '创建者身份无效', 403);
    state.workspace.teams = [...(state.workspace.teams ?? []), { id, name, members: [{ ...creator }], createdAt: at }]; return '创建团队';
  }
  const teamId = clean(input.teamId, '团队范围', 100), team = requireTeamOwner(state, role, teamId);
  // Default team fields are mutated on their original object; other teams are stored directly.
  const target = teamId === defaultTeamId ? state.workspace.team : state.workspace.teams!.find(item => item.id === teamId)!;
  if (action === 'team.update') { const name = teamName(input.name); need(!allTeams(state).some(item => item.id !== teamId && folded(item.name) === folded(name)), '团队名称已存在'); target.name = name; return '更新团队信息'; }
  if (action === 'team.project.assign') {
    const projectId = clean(input.projectId, '项目标识', 100), source = projectTeam(state, projectId);
    requireTeamOwner(state, role, source.id); need(input.fromTeamId === source.id, '项目所属团队已变化，请刷新后重新确认'); need(source.id !== teamId, '项目已属于此团队');
    need([...assignedIds(state, projectId)].every(id => team.members.some(member => member.id === id && member.status === 'active')), '请先将项目已有交付人加入目标团队，再关联项目');
    if (projectId === 'carddemo') state.workspace.projectTeamId = teamId;
    else { const project = state.workspace.projects!.find(item => item.id === projectId)!; project.teamId = teamId; project.updatedAt = at; }
    return '调整项目所属团队';
  }
  if (action === 'member.invite') {
    let member: TeamMember;
    if (input.memberId !== undefined) { const known = allTeams(state).flatMap(item => item.members).find(item => item.id === input.memberId && item.status === 'active'); need(known, '所选成员不存在'); member = { ...known, role: 'member', status: 'invited' }; }
    else { const name = clean(input.name, '成员姓名', 40); need(!allTeams(state).some(item => item.members.some(person => folded(person.name) === folded(name))), '该姓名已有成员，请从已有成员中选择'); member = { id: 'member-' + (state.revision + 1), name, role: 'member', status: 'invited' }; }
    need(!team.members.some(item => item.id === member.id || folded(item.name) === folded(member.name)), '该成员已在团队或邀请列表中'); need(team.members.length < 50, '团队成员数量已达上限'); target.members.push(member); return '创建成员邀请';
  }
  const member = target.members.find(item => item.id === input.id); need(member, '成员或邀请记录不存在');
  if (action === 'member.approve') { need(member.status === 'invited', '邀请记录不存在'); member.status = 'active'; return '确认成员加入'; }
  need(member.id !== 'owner' && !(teamId === defaultTeamId && member.id === 'member'), '无法修改或移除固定角色');
  need(!teamProjects(state).some(project => project.teamId === teamId && assignedIds(state, project.id).has(member.id)), '请先调整需求或任务交付人，再更改该成员的角色或移除成员');
  if (action === 'member.role') { need(member.id !== 'member', '固定成员身份的角色不可修改'); need(member.status === 'active' && (input.role === 'owner' || input.role === 'member'), '角色无效'); member.role = input.role; return '调整团队角色'; }
  target.members = target.members.filter(item => item.id !== member.id); return '移除团队成员';
}
export function validateTeams(state: DemoState) {
  const extras = state.workspace.teams;
  need(extras === undefined || Array.isArray(extras), '团队清单无效；未自动覆盖');
  const ids = new Set<string>(), names = new Set<string>();
  for (const team of allTeams(state)) {
    need(team && (team.id === defaultTeamId || teamIdPattern.test(team.id)) && !ids.has(team.id), '团队标识无效或重复'); ids.add(team.id);
    const name = teamName(team.name); need(!names.has(folded(name)), '团队名称重复'); names.add(folded(name));
    need(Array.isArray(team.members) && team.members.length > 0 && team.members.length <= 50, '团队成员清单无效');
    const memberIds = new Set<string>();
    for (const member of team.members) { clean(member?.id, '成员标识', 100); clean(member.name, '成员姓名', 40); need(!memberIds.has(member.id) && ['owner','member'].includes(member.role) && ['active','invited'].includes(member.status), '团队成员记录无效'); memberIds.add(member.id); }
    need(team.members.some(member => member.id === 'owner' && member.role === 'owner' && member.status === 'active'), '团队创建者记录无效');
    if (team.id !== defaultTeamId) need(typeof team.createdAt === 'string' && Number.isFinite(Date.parse(team.createdAt)), '团队创建时间无效');
  }
  need(!Object.hasOwn(state.workspace, 'projectTeamId') || typeof state.workspace.projectTeamId === 'string', '项目团队归属无效');
  projectTeam(state, 'carddemo'); for (const project of state.workspace.projects ?? []) projectTeam(state, project.id);
  for (const project of teamProjects(state)) need([...assignedIds(state, project.id)].every(id => projectMembers(state, project.id).some(member => member.id === id && member.status === 'active')), '项目交付人与所属团队不一致');
}
