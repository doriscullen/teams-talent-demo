export interface TaskKnowledgeAsset { id: string; title: string; version: string; detail: string; origin: 'teams-task' | 'talents-shared' | 'teams-node-preset' | 'plugin-mock'; artifactId?:string; contentSha256?:string; sourceRecordId?:string; sourceProjectId?:string; sourceProjectName?:string; pluginId?:string; kind?:string; summary?:string; references?:Array<{collection:string;path:string;label:string;absolutePath?:string;sha256?:string;version?:string}>; relatedRequirementIds?:string[] }
export interface TalentTaskInputs {
  projectId: string; taskId: string; generation: string; origin: string;
  requirement: { id: string; title: string; description: string };
  knowledge: { status: 'ready' | 'not-built'; version?: string; assets: TaskKnowledgeAsset[] };
  skills: Array<{ id: string; name: string; version: string; sha256: string; contentSha256: string; content: string; source: 'teams-registered-package' }>;
}
export interface TalentTaskSession {
  tool: 'icode' | 'opencode'; sessionId: string; nodeIds: string[]; runIds: string[]; sources: string[]; firstAt: string; lastAt: string;
}
export interface TalentTaskSessionPayload {
  projectId: string; taskId: string; deliveryId: string; idempotencyKey: string;
  acceptedAt: string; inputDigest: string; sessions: TalentTaskSession[];
  sessionDocuments?: Array<{ sessionId: string; sha256: string; content: string }>;
}
export interface TalentTaskSessionReceipt { id: string; receivedAt: string; projectId: string; taskId: string; sessionIds: string[]; payloadSha256: string; documentHashes?: Array<{ sessionId: string; sha256: string }> }
export interface TalentTaskIntake { generation: string; payload: TalentTaskSessionPayload; receipt: TalentTaskSessionReceipt }
