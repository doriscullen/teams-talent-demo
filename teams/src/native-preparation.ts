/** A background reading turn, not adoption, development, or node completion. */
export interface NativePreparationReceipt {
  status: 'ready'; runId: string; sessionId: string; directory: string; preparedAt: string;
  contextPath: string; contextSha256: string; skillPath: string; sessionSha256: string;
  agent: string; agentLabel: string; model: string; modelLabel: string;
  readEvidence: Array<{ path: string; callId: string; sha256: string }>;
  summary: string;
}
export type NativePreparationResult = NativePreparationReceipt | { status: 'waiting-directory'; reason: string };
