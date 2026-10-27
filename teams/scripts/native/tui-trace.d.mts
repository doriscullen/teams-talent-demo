export function nativeTraceEnvironment(base: NodeJS.ProcessEnv, scope: {projectId:string;taskId?:string;nodeId?:string;runId?:string}, endpoint?: string): {env: NodeJS.ProcessEnv;endpoint:string;sensitiveData:boolean;enabled:boolean};
export function checkNativeTraceReceiver(endpoint:string,expected?:{app?:string;workspaceRoot?:string;stateRoot?:string}): Promise<{endpoint:string;status:string}>;
export interface TraceLaunchSettings {app?:string;endpoint:string;enabled:boolean;sensitiveData:boolean;serviceName?:string;resourceAttributes?:string;workspaceRoot?:string;stateRoot?:string}
export function traceLaunchSettings(trace:ReturnType<typeof nativeTraceEnvironment>):TraceLaunchSettings;
export function traceLaunchEnvironment(base:NodeJS.ProcessEnv,settings?:TraceLaunchSettings):NodeJS.ProcessEnv;
