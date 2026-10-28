import { taskArtifactKinds, unitTestExecutionShapeErrors, type UnitTestExecution, type TaskArtifactKind } from './task-node-contract.js';
import type { Role } from './domain.js';

/** Local demo adaptation of Teams context/adoption/progress/result contracts. */
export interface CollaborationScope { projectId: string; taskId?: string; nodeId?: string; tab?: string }
export interface CollaborationEvidence { kind: 'reference' | 'local-file'; value: string; description: string; artifact?:TaskArtifactKind; version?:string; codeVersion?:string; source?:'actual'|'preset';execution?:UnitTestExecution }
export interface CollaborationAdoption extends CollaborationScope {
  id: string; role: Role; runId: string; sessionId: string | null; basisDigest: string;
  readReferences: string[]; at: string; revision: number;
}
export interface CollaborationEvent extends CollaborationScope {
  id: string; operationId: string; role: Role; runId: string; sessionId: string | null;
  adoptionId: string; phase: 'started' | 'progress' | 'blocked' | 'result'; summary: string;
  completedCriteria?:string[]; reopen?:true; blocker: string | null; evidence: CollaborationEvidence[]; at: string; revision: number;
}
export interface CollaborationReceipt {
  operationId: string; requestDigest: string; revision: number; kind: string;
  projectId: string; taskId?: string; nodeId?: string; adoptionId: string;
  eventId?: string; at: string; status: 'saved';
}
export interface CollaborationState {
  adoptions: CollaborationAdoption[]; events: CollaborationEvent[]; operations: CollaborationReceipt[];
}

export function validateCollaborationState(value: unknown): asserts value is CollaborationState {
  const v = value as CollaborationState;
  if (!v || !Array.isArray(v.adoptions) || !Array.isArray(v.events) || !Array.isArray(v.operations)
    || v.adoptions.some(a => !a || typeof a.id !== 'string' || !a.projectId || !a.taskId || !a.nodeId || !a.runId || !a.basisDigest || !Array.isArray(a.readReferences))
    || v.events.some(e => !e || !e.id || !e.projectId || !e.taskId || !e.nodeId || !e.runId || !['started', 'progress', 'blocked', 'result'].includes(e.phase) || typeof e.summary !== 'string' || !Array.isArray(e.evidence))
    || v.events.some(e=>e.reopen!==undefined&&(e.reopen!==true||e.phase!=='started'||!['prepare','develop','verify'].includes(e.nodeId??'')))
    || v.events.some(e=>e.evidence.some(item=>item.artifact!==undefined&&(!taskArtifactKinds.includes(item.artifact)||typeof item.version!=='string'||!item.version.trim()||!['actual','preset'].includes(item.source??'')||item.codeVersion!==undefined&&(typeof item.codeVersion!=='string'||!item.codeVersion.trim())))||e.evidence.some(item=>item.execution!==undefined&&(item.artifact!=='unit-test-result'||unitTestExecutionShapeErrors(item.execution).length>0))||e.completedCriteria!==undefined&&(!Array.isArray(e.completedCriteria)||e.completedCriteria.some(id=>typeof id!=='string')) )
    || v.operations.some(o => !o || !o.operationId || !o.requestDigest || o.status !== 'saved' || !Number.isSafeInteger(o.revision))
    || new Set(v.operations.map(o => o.operationId)).size !== v.operations.length) throw new Error('协作记录损坏；未自动覆盖');
}
