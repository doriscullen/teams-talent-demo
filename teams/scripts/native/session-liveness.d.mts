export interface NativeProcessIdentity { startedAt: string; state: string }
export function inspectNativeProcess(pid: number, platform?: NodeJS.Platform): Promise<NativeProcessIdentity | null>;
export function nativeProcessActive(owner: { pid: number; startedAt: string }, processRecord?: { pid: number; startedAt: string } | null, inspect?: (pid: number) => Promise<NativeProcessIdentity | null>): Promise<boolean>;
