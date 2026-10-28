import type { RequirementNode } from './delivery-requirements.js';
export interface TaskArtifactQuery {projectId:string;taskId:string;nodeId:RequirementNode;artifactId:string;version:string}
export interface TaskArtifactContent {
 artifactId:string;projectId:string;taskId:string;nodeId:RequirementNode;title:string;version:string|null;codeVersion?:string;
 kind:'document'|'link';content?:string;url?:string;sha256?:string;bytes?:number;
 integrity:'registered-sha256'|'git-commit'|'current-file'|'saved-link';note:string;
}
