export interface ProjectWorkSelection {
  projectId: string;
  tab: string;
  taskId?: string;
  requirementId?: string;
  nodeId?: string;
  discussionId?: string;
  releaseId?: string;
}
export interface ProjectWorkTrace { endpoint:string;enabled:boolean;sensitiveData:boolean;readiness:'ready'|'unavailable'|'disabled';diagnostic:string }
export type ProjectWorkAction = 'new' | 'resume' | 'focus';
export interface ProjectWorkReceipt {
  requestId: string;
  executionMode?: 'task-file' | 'interactive';
  target: ProjectWorkSelection;
  action: ProjectWorkAction;
  status: 'prepared' | 'terminal-requested' | 'terminal-focused' | 'uncertain';
  at: string;
  directory: string;
  terminal?: string;
  trace?: ProjectWorkTrace;
  sessionId: string | null;
  contextPath: string;
  instruction: string;
  note: string;
}
export interface ProjectWorkPlan {
  executionMode?: 'task-file' | 'interactive';
  target: ProjectWorkSelection;
  projectName: string;
  title: string;
  location: string;
  source: string;
  planToken: string;
  instance: { trace?: ProjectWorkTrace; terminal?: { id: string; name: string; error?: string }; installed: boolean; name: string; agent?: string; agentLabel?: string; model?: string; modelLabel?: string };
  directory: { root: string | null; valid: boolean; kind: 'imported-snapshot' | 'git-binding'; diagnostic: string };
  history?: { sessionId: string; directory: string; title: string; available: boolean; diagnostic?: string; prepared?: { preparationRunId: string; sourceRunId: string; sessionSha256: string }; configuration?: {agent: string; agentLabel: string; model: string; modelLabel: string}; active: { pid: number; application: string | null; tty: string; terminal?: { id: string; kind?: string; title: string; directory: string }; diagnostic?: string } | null };
  context: { frozen: boolean; summary: string; versions: string; selectedSkills: string[]; assets: Array<{ title: string; location: string }> };
  actions: Array<{ id: ProjectWorkAction; label: string; enabled: boolean; reason?: string }>;
  defaultAction: ProjectWorkAction;
  previous?: ProjectWorkReceipt;
}
