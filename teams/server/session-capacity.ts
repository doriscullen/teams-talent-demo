import { DomainError } from '../src/domain.js';

/** Limits apply to original UTF-8 bytes, before JSON wrapper escaping. Never truncate history. */
export const MAX_NATIVE_SESSION_BYTES = 32 * 1024 * 1024;
export const MAX_NATIVE_TRAJECTORY_BYTES = 64 * 1024 * 1024;
export const MAX_TASK_SESSION_DOCUMENT_BYTES = 128 * 1024 * 1024;

export function sessionDocumentBytes(content: unknown): number {
  if (typeof content !== 'string' || !content.length) throw new DomainError('会话文档为空或无效', 400);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_NATIVE_SESSION_BYTES) throw new DomainError('单个会话文档超过 32 MiB，未截断或上报', 413);
  return bytes;
}

export function assertSessionDocumentTotal(bytes: number): void {
  if (bytes > MAX_TASK_SESSION_DOCUMENT_BYTES) throw new DomainError('一次归集的会话正文合计超过 128 MiB，未截断或上报', 413);
}

/** Preflight the entire batch before parsing/hashing/persisting any document. */
export function validateSessionDocumentCapacity(documents: readonly unknown[]): void {
  let bytes = 0;
  for (const document of documents) {
    bytes += sessionDocumentBytes(document && typeof document === 'object' ? (document as { content?: unknown }).content : undefined);
    assertSessionDocumentTotal(bytes);
  }
}
