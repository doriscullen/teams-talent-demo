import type { RequirementNode } from './delivery-requirements.js';

export interface TaskSessionStreamQuery { projectId: string; taskId: string; nodeId: RequirementNode; sessionId?: string; cursor?: string }
export type TaskSessionStatus = 'running' | 'completed' | 'failed' | 'unavailable' | 'unknown';
export interface TaskSessionSummary {
  id: string; tool: 'icode' | 'opencode'; title: string; nodeIds: string[]; runIds: string[];
  status: TaskSessionStatus; lastAt: string | null; note?: string;
}
export interface TaskSessionMessage { id: string; at: string; text: string }
export interface TaskSessionTurn {
  id: string; sessionId: string; runId: string; nodeId: RequirementNode;
  turnId: string; round: number | null; startedAt: string; updatedAt: string;
  status: 'running' | 'ended' | 'failed' | 'unknown';
  user: TaskSessionMessage | null; replies: TaskSessionMessage[];
  /** A round can span nodes. Do not repeat another node's input as a new user message. */
  userSourceNode?: RequirementNode; note?: string;
}
export interface TaskSessionStreamResponse {
  sessions: TaskSessionSummary[]; selectedSessionId: string | null; turns: TaskSessionTurn[];
  cursor: string | null;
  /** Replace existing turns when true; otherwise upsert by turn.id and original message IDs. */
  reset: boolean; hasMore: boolean; observedAt: string; pollAfterMs: number; note: string;
}
