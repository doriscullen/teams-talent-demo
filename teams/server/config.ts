import { materialRoot } from './service-config.ts';
import { resolveICodeBinary } from './icode-binary.ts';
export * from './service-config.ts';
const icode = resolveICodeBinary({ materialRoot });
export const binary = icode.path;
export const icodeBinarySource = icode.source;
export const icodeBinaryNotes = icode.notes;
