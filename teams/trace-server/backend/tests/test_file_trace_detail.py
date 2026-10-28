"""文件详情计数回归。可用 TRACE_DETAIL_REPLAY 指定只读真实 JSONL 回放。"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from api.helpers import build_tree, span_out, trace_out
from db.backends.file_backend import FileBackend


class FileTraceDetailTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backend = FileBackend(self.root)

    def write_events(self, events, project="project", session="session", trace="trace"):
        path = self.root / project / session / f"{trace}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(event) + "\n" for event in events))
        return path

    def span(self, identity, kind, **fields):
        return {"event_type": "span", "trace_id": "trace", "id": identity,
                "event_id": f"event-{identity}", "name": identity, "span_type": kind,
                "parent_span_id": None if identity == "root" else "root", **fields}

    def summary(self, **fields):
        return {"event_type": "trace", "trace_id": "trace", "id": "trace",
                "project_id": "project", "session_id": "session", "name": "batch root",
                "span_count": 2, "tool_count": 0, **fields}

    def tree_spans(self, spans):
        def flatten(nodes):
            return [node.span for node in nodes] + [span for node in nodes for span in flatten(node.children)]
        return flatten(build_tree([span_out(span) for span in spans]))

    async def test_complete_file_counts_replace_last_batch_summary_and_match_tree(self):
        spans = [self.span("root", "agent")]
        spans += [self.span(f"llm-{n}", "llm") for n in range(4)]
        spans += [self.span(f"tool-{n}", "tool") for n in range(7)]
        events = spans[:6] + [self.summary(trace_insert_only=True)] + spans[6:] + [self.summary()]
        path = self.write_events(events)
        before = path.read_bytes()
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        api_trace = trace_out(detail.trace)
        tree = self.tree_spans(detail.spans)
        self.assertEqual((api_trace.spanCount, api_trace.toolCount), (12, 7))
        self.assertEqual(len(tree), api_trace.spanCount)
        self.assertEqual(sum(span.spanType == "tool" for span in tree), api_trace.toolCount)
        self.assertIsNone(api_trace.totalTokens)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(await self.backend.export_trace_jsonl("project", "trace", "session"), before.decode())

    async def test_retransmission_deduplicates_span_identity_and_preserves_recorded_tokens(self):
        tool = self.span("tool", "tool", output="first")
        events = [self.summary(total_tokens=31), self.span("root", "agent"), tool,
                  dict(tool), dict(tool, event_id="different-event-same-span", output="completed")]
        self.write_events(events)
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        self.assertEqual((detail.trace["span_count"], detail.trace["tool_count"]), (2, 1))
        self.assertEqual(detail.spans[1]["output"], "completed")
        self.assertEqual(detail.trace["total_tokens"], 31)
        self.assertEqual(len(self.tree_spans(detail.spans)), 2)

    async def test_known_non_tool_spans_mean_zero_tools_not_stale_summary(self):
        self.write_events([self.summary(tool_count=9), self.span("root", "agent"), self.span("llm", "llm")])
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        self.assertEqual((detail.trace["span_count"], detail.trace["tool_count"]), (2, 0))

    async def test_unknown_classification_or_identity_is_not_fabricated(self):
        self.write_events([self.summary(), self.span("root", None)])
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        self.assertEqual(detail.trace["span_count"], 1)
        self.assertIsNone(detail.trace["tool_count"])
        self.assertIsNone(trace_out(detail.trace).totalTokens)
        self.write_events([self.summary(), self.span(None, "tool"), self.span(None, "tool")])
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        self.assertEqual(len(detail.spans), 2)
        self.assertIsNone(detail.trace["span_count"])
        self.assertIsNone(detail.trace["tool_count"])

    async def test_missing_summary_still_counts_unique_spans_without_inventing_tokens(self):
        tool = self.span("tool", "tool")
        self.write_events([self.span("root", "agent"), tool, tool])
        detail = await self.backend.get_trace_detail("project", "trace", "session")
        self.assertEqual((detail.trace["span_count"], detail.trace["tool_count"]), (2, 1))
        for key in ("total_tokens", "prompt_tokens", "completion_tokens"):
            self.assertIsNone(detail.trace[key])

    async def test_list_still_reads_only_paths_and_has_no_summary(self):
        self.write_events([self.summary()])
        with patch.object(self.backend, "_read_trace_file", side_effect=AssertionError("list must not read events")):
            rows, total = await self.backend.list_traces("project")
        self.assertEqual(total, 1)
        self.assertEqual(rows, [{"id": "trace", "project_id": "project", "session_id": "session"}])

    @unittest.skipUnless(os.getenv("TRACE_DETAIL_REPLAY"), "explicit real JSONL replay not requested")
    async def test_real_record_copy_has_twelve_spans_seven_tools_and_unchanged_export(self):
        source = Path(os.environ["TRACE_DETAIL_REPLAY"])
        original = source.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        project, session, trace = source.parent.parent.name, source.parent.name, source.stem
        path = self.root / project / session / source.name
        path.parent.mkdir(parents=True)
        path.write_bytes(original)
        detail = await self.backend.get_trace_detail(project, trace, session)
        projected = trace_out(detail.trace)
        self.assertEqual((projected.spanCount, projected.toolCount), (12, 7))
        self.assertEqual(len(self.tree_spans(detail.spans)), 12)
        self.assertEqual(sum(s.spanType == "tool" for s in self.tree_spans(detail.spans)), 7)
        raw_summary = self.backend._pick_trace_event(self.backend._read_trace_file(path), trace)
        self.assertEqual((raw_summary["span_count"], raw_summary["tool_count"]), (2, 0))
        for key in ("total_tokens", "prompt_tokens", "completion_tokens"):
            self.assertEqual(detail.trace.get(key), raw_summary.get(key))
        self.assertEqual(await self.backend.export_trace_jsonl(project, trace, session), original.decode())
        # 重放所有原始事件，仅写临时副本，既不改变计数也不改真实采集文件。
        path.write_bytes(original.rstrip(b"\n") + b"\n" + original)
        replay = await self.backend.get_trace_detail(project, trace, session)
        self.assertEqual((replay.trace["span_count"], replay.trace["tool_count"]), (12, 7))
        self.assertEqual(len(self.tree_spans(replay.spans)), 12)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
