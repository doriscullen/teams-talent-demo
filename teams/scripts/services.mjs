import { origin, runtimeDir, root } from '../server/service-config.ts';
export { root };

export const services = [
  { id: 'teams', origin, runtimeDir, entry: 'server/index.ts', app: 'teams-talent-carddemo' },
];
export function selectedServices() { return services; }
export async function serviceHealth(service) {
  try {
    const response = await fetch(service.origin + '/api/health', { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error(service.origin + ' 已被其他服务占用');
    const data = await response.json();
    if (data.app !== service.app) throw new Error(service.origin + ' 已被其他服务占用');
    if (data.workspaceRoot !== root || data.stateRoot !== service.runtimeDir) throw new Error(service.origin + ' 已有其他目录或旧版服务，未接管；请选择另一个 DEMO_PORT');
    return data;
  } catch (error) { if (error.cause?.code === 'ECONNREFUSED') return null; throw error; }
}
