import type { RequirementNode } from './delivery-requirements.js';
import type { TalentTaskInputs } from './talent-contract.js';
/** Talent selection metadata is a declared scenario preset, never a model recommendation or an adoption receipt. */
export interface TalentNodeInputs extends TalentTaskInputs {
  nodeId: RequirementNode;
  selection: {
    version: string; source: 'preset-scenario' | 'teams-node-selection'; status: 'configured' | 'not-configured';
    basis: 'recommendation' | 'adopted-node' | 'historical-subset';
    note: string; missingSkillIds: string[];
    scenario?: { id:string; artifactId:string; artifactVersion:number; matchedBy:'project-and-exact-title'; origin:'scenario-fixture' };
    knowledge: Array<{ id: string; slot: string; reason: string; nodeId: RequirementNode }>;
    skills: Array<{ id: string; slot: string; reason: string; nodeId: RequirementNode }>;
  };
}
