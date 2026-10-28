# CodeGraph demo archive

This directory contains a real CodeGraph scan of `workspace/carddemo-java-1025`, frozen for repeatable demonstrations. It does not track the current workspace. Starting the app, rendering the graph, and running tests do not require CodeGraph, Java, or a live `.codegraph/` directory.

`current.json` selects a directory under `snapshots/<snapshotId>/`:

- `graph.json`: nodes, edges, provenance, statistics, and captured source text for the visualization.
- `codegraph.db.gz`: a compressed, standalone SQLite backup of the original CodeGraph database, including committed WAL content.
- `manifest.json`: tool version, scan time, source digest, database schema, sizes, and archive checksums.

Commit these files together. Existing snapshot directories are retained when a new snapshot is exported. To demonstrate an earlier snapshot, change the ID in `current.json` and restart Talents; no indexing is needed. The JSON is loaded by the Talents service, not bundled into the frontend JavaScript.

## Optional: create another demo snapshot

From the repository root, using the installed CodeGraph CLI and Node.js 24:

```sh
codegraph init workspace/carddemo-java-1025 --yes  # first scan only
# Or: codegraph index workspace/carddemo-java-1025
npm --prefix talents run codegraph:export
npm --prefix talents run seed:shared
```

Exporting an older index is also supported. Missing or modified workspace files are omitted from the source preview rather than blocking export. Already archived snapshots keep their captured source text and are not rewritten. No command runs automatically at app startup.

To inspect the original index without changing the workspace:

```sh
mkdir -p /tmp/carddemo-archived/.codegraph
gzip -dc talents/data/codegraph/snapshots/5774e64217fd5b2c/codegraph.db.gz > /tmp/carddemo-archived/.codegraph/codegraph.db
sqlite3 /tmp/carddemo-archived/.codegraph/codegraph.db 'select kind, count(*) from nodes group by kind;'
```

## Browsing

Open Talents at `/talents/#/projects?project=carddemo&tab=review&id=a-cg-java`. Developer previews also display the graph. Teams links to it from the CodeGraph knowledge details.

The default view shows marketing-service files. Switch to the service overview or symbol view; search, filter relationships and tests, or expand one/two-hop symbol neighborhoods. Node details display archived source lines, not current workspace files.

The initial scan contains 324 indexed files, 4,606 nodes, 7,676 relationships, and no recorded parse errors. Its 8,563 unresolved references include framework/external symbols and unresolved project references. There are 196 cross-service `calls` edges, including observed same-name misresolution. These calls are hidden by default and marked for verification when enabled. Service/file edges aggregate index relationships and are not runtime architecture evidence.
