export interface ArtifactRoot {projectId:string;taskId:string;directory:string;registeredAt:string;nativeRunId?:string}
export const artifactRootsFilename:string;
export function contained(root:string,path:string):boolean;
export function canonicalDirectory(path:string):Promise<string>;
export function readTaskArtifactRoots(options:{runtime:string;teamsRoot:string;projectId:string;taskId:string}):Promise<ArtifactRoot[]>;
export function registerTaskArtifactRoot(options:{runtime:string;teamsRoot:string;projectId:string;taskId:string;directory:string;nativeRunId?:string}):Promise<ArtifactRoot>;
