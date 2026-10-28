export interface CarddemoWorktreeBinding {kind:'carddemo-worktree';projectId:'carddemo';taskId:string;recordedDirectory:string|null;directory:string;worktreeRoot:string;branch:string;baseBranch:'develop';baseCommit:string;platformRoot:string;commonDirectory:string;remote:'origin';remoteUrl:string}
export const carddemoSubdirectory:string;
export function configurationPath(repo:string):string;
export function readCarddemoWorkspace(repo:string):Promise<null|{version:1;enabledAt:string;projectId:'carddemo';platformRoot:string;commonDirectory:string;remote:'origin';remoteUrl:string;baseBranch:'develop';baseCommit:string;businessSubdirectory:string;baseWorktreeRoot:string}>;
export function initializeCarddemoWorkspace(options:{repo:string;baseCommit?:string;expectedOrigin?:string;worktree?:string;apply?:boolean}):Promise<any>;
export function initializeCarddemoTask(options:{repo:string;runtime:string;projectId:string;taskId:string;worktree?:string;apply?:boolean}):Promise<any>;
export function readCarddemoTaskBinding(repo:string,runtime:string,task:{projectId:string;id:string;workDirectory?:string}):Promise<CarddemoWorktreeBinding|null>;
export function validateCarddemoTaskBinding(repo:string,task:{projectId:string;id:string;workDirectory?:string},binding:CarddemoWorktreeBinding):Promise<CarddemoWorktreeBinding>;

export function ensureCarddemoTaskWorkspace(options:{repo:string;runtime:string;projectId:string;taskId:string;preparationId:string}):Promise<CarddemoWorktreeBinding|null>;
