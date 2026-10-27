export interface GraphNode {
  id: string; kind: string; name: string; qualifiedName: string; filePath: string; language: string;
  startLine: number; endLine: number; signature: string | null;
  service: string; layer: string; test: boolean;
}
export interface GraphEdge {
  id: number; source: string; target: string; kind: string;
  line: number | null; provenance: string | null; crossService: boolean;
}
export interface GraphSnapshot {
  schemaVersion: 1;
  metadata: {
    project: string; root: string; toolVersion: string; indexedAt: string; exportedAt: string;
    revision: string; sourceDigest: string; snapshotId: string; files: number; nodes: number; edges: number;
    parseErrors: number; unresolved: number; crossServiceCalls: number;
    nodeKinds: Record<string, number>; edgeKinds: Record<string, number>;
  };
  nodes: GraphNode[]; edges: GraphEdge[];
}
export interface StoredGraphSnapshot extends GraphSnapshot { sources: Record<string, string> }
