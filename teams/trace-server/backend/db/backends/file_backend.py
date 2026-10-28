"""file 存储后端：无内存索引，全部实时读盘。

读取策略（无缓存，永远读最新）：
- 列表 / 项目：按固定两层目录布局枚举 *.jsonl **文件路径**，不读文件内容。
  trace 列表只从路径拆出 {id, sessionId, projectId}，不展示摘要、不排序、
  不做 agent/status 过滤（前端列表页不展示这些信息）。
- 详情：优先按 <pid>/<sid>/<trace_id>.jsonl 直拼路径 O(1) 定位（session_id
  未提供/未命中时回退项目内按范围 glob 兜底）；真实 LLM 请求按 event_id
  直达读 llm_request/<event_id>.json。真实 LLM 请求是 *.json，天然被
  `*.jsonl` 过滤，不参与 trace 索引。

目录布局（SDK 写入）：
  <DATA_FILE>/<project_id>/<session_id>/<trace_id>.jsonl               # 有 session_id
  <DATA_FILE>/<project_id>/_no_session/<trace_id>.jsonl                # 无 session_id
  <DATA_FILE>/<project_id>/<session_id>/llm_request/<event_id>.json    # 真实 LLM 请求
"""
from __future__ import annotations

import datetime
import json
import os
from glob import escape
from pathlib import Path
from typing import Any, Iterator

from config import DATA_FILE
from .base import StorageBackend, TraceData

# JSONL 中 event_type → 类型
_EVENT_TRACE = "trace"
_EVENT_SPAN = "span"
_EVENT_OBSERVATION = "observation"
_EVENT_SESSION = "session"
_EVENT_LLM_REQUEST = "llm_request"


class FileBackend(StorageBackend):
    def __init__(self, data_dir: str | Path | None = None):
        self._data_dir = Path(data_dir or DATA_FILE)

    # ---- 实时读盘 ----

    def _iter_trace_files(self, root: Path | None = None) -> Iterator[Path]:
        """按固定两层布局枚举 trace 文件路径（不读文件内容、不递归）。

        布局约定（SDK 写入）：<data_dir>/<project_id>/<session_id>/<trace_id>.jsonl。
        因此只需两次 scandir：项目目录 → session 目录 → 取目录下的 *.jsonl。

        不递归的原因：数据目录常 bind-mount 到 Windows（Docker Desktop 走 9p/drvfs），
        单次目录系统调用是毫秒级，全盘 rglob 会被测试残留的深层目录拖到 6s+；
        而标准布局只有两层，实测 6.3s → 0.2s。

        root 为项目子目录（<data_dir>/<project_id>）时只扫该项目；root 为 None
        时先枚举 data_dir 下的项目目录。llm_request 目录位于第三层且存 *.json，
        本方法不会进入，天然不混入 trace 列表。
        """
        base = root or self._data_dir
        if not base.is_dir():
            return
        project_dirs = [base] if root is not None else self._scandir_dirs(base)
        for project_dir in project_dirs:
            for session_dir in self._scandir_dirs(project_dir):
                for f in self._scandir_trace_files(session_dir):
                    yield f

    @staticmethod
    def _scandir_dirs(path: Path) -> Iterator[Path]:
        """列出目录下的直接子目录（无子目录/不可读时返回空）。"""
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        if entry.is_dir():
                            yield Path(entry.path)
                    except OSError:
                        continue
        except OSError:
            return

    @staticmethod
    def _scandir_trace_files(path: Path) -> Iterator[Path]:
        """列出目录下的 *.jsonl 文件（非递归）。"""
        try:
            with os.scandir(path) as it:
                for entry in it:
                    if not entry.name.endswith(".jsonl"):
                        continue
                    try:
                        if entry.is_file():
                            yield Path(entry.path)
                    except OSError:
                        continue
        except OSError:
            return

    def _read_trace_file(self, path: Path) -> list[dict[str, Any]]:
        """读单个 trace 文件全部事件行（详情用，每次读盘保证最新）。"""
        events: list[dict[str, Any]] = []
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
        except OSError:
            pass
        return events

    def _find_trace_file(self, trace_id: str, project_id: str, session_id: str | None) -> Path | None:
        """在指定项目内回退定位；提供会话时同时限制会话目录。

        项目内的嵌套历史目录仍可读取，但不能因直拼路径未命中而读取其他项目；
        显式 session_id 不匹配时也不能回退到同项目的其他会话。
        """
        root = self._data_dir / project_id
        if not project_id or not root.is_dir():
            return None
        trace_pattern = escape(trace_id) + ".jsonl"
        pattern = f"**/{escape(session_id)}/{trace_pattern}" if session_id else f"**/{trace_pattern}"
        for f in root.glob(pattern):
            return f
        return None

    def _trace_file_at(
        self, project_id: str, session_id: str | None, trace_id: str
    ) -> Path | None:
        """按 <pid>/<sid>/<trace_id>.jsonl 直拼路径定位（O(1)，不遍历）。

        session_id 为空时落 _no_session 目录。找到即返回，否则 None（调用方
        回退到 _find_trace_file 在项目内按范围兜底，兼容历史目录/手动挪动等场景）。
        """
        sid = session_id if session_id else "_no_session"
        p = self._data_dir / project_id / sid / f"{trace_id}.jsonl"
        return p if p.is_file() else None

    def _find_llm_request(self, project_id: str, event_id: str) -> dict[str, Any] | None:
        """按 project_id + event_id 直达读 llm_request/<event_id>.json（一事件一文件）。

        SDK 写盘路由 <data_dir>/<pid>/<sid>/llm_request/<event_id>.json，
        文件名即 event_id。project_id 决定扫描根：<data_dir>/<project_id> 下
        glob 按文件名命中即读，把遍历范围限制在指定项目内，避免全盘扫
        （bench 残留的 sess-bench 等其它项目目录不再拖慢本查询）。
        """
        root = self._data_dir / project_id
        if not root.is_dir():
            return None
        for f in root.glob(f"**/llm_request/{event_id}.json"):
            try:
                with open(f, encoding="utf-8") as fh:
                    ev = json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(ev, dict):
                return ev
        return None

    # ---- 统一查询接口 ----

    def _project_roots(self, project_id: str) -> Path | None:
        """解析 project_id（逗号分隔多值）对应的扫描根目录。

        返回 None 表示未指定项目：扫描 data_dir 下所有项目目录，再由调用方
        按 project_id 过滤；多项目时同样返回 None（共用 data_dir 作根）。
        """
        if not project_id:
            return None
        pids = [p for p in project_id.split(",") if p]
        if len(pids) == 1:
            return self._data_dir / pids[0]
        return None

    async def list_traces(
        self,
        project_id: str,
        page: int = 1,
        page_size: int = 20,
        agent_name: str | None = None,
        status: str | None = None,
        session_id: str | None = None,
        trace_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """trace 列表：只列 *.jsonl 文件路径，不读文件内容。

        返回 {id, project_id, session_id} 三字段全部从路径拆出（snake_case，
        与 database 后端一致，路由层 trace_out 直接读取）：
          <data_dir>/<project_id>/<session_id>/<trace_id>.jsonl（无 session 为 _no_session/）
        按固定两层布局扫描（见 _iter_trace_files）：非标准深度的历史残留目录
        （如测试用例写入的 <pid>/<case>/<pid>/<sid>/<trace_id>.jsonl）不会出现在
        列表里，但详情/导出仍能按 trace_id 全盘兜底定位到。

        列表页不展示摘要、不排序、不做 agent/status 过滤，因此 agent_name/status
        形参仅为兼容基类签名，实现里完全忽略（前端不再传）。
        """
        roots = self._project_roots(project_id)
        items: list[dict[str, Any]] = []
        for f in self._iter_trace_files(roots):
            parts = f.relative_to(self._data_dir).parts
            pid = parts[0] if len(parts) > 0 else "default"
            sid = parts[1] if len(parts) > 1 else ""
            tid = f.stem  # 文件名去 .jsonl 即 trace_id
            # 跳过非 trace 文件（如 _no_trace 兜底留痕目录、projects.json 等）
            if not tid or tid.startswith("_") or pid.startswith("_"):
                continue
            items.append({"id": tid, "project_id": pid, "session_id": sid})
        # project_id 支持逗号分隔多值
        if project_id:
            allowed = set(project_id.split(","))
            items = [t for t in items if t["project_id"] in allowed]
        # 关键词：trace_id / session_id 任一命中即返回（OR 语义，纯字符串匹配）
        if session_id or trace_id:
            items = [
                t for t in items
                if (trace_id and trace_id in t["id"])
                or (session_id and session_id in t["session_id"])
            ]
        total = len(items)
        start = (page - 1) * page_size
        page_items = items[start : start + page_size]
        return page_items, total

    async def get_trace_detail(
        self,
        project_id: str,
        trace_id: str,
        session_id: str | None = None,
    ) -> TraceData | None:
        # 惰性读单文件：每次读盘拿到最新（新追加的 span/obs 也在）。
        # 带 session_id 时按 <pid>/<sid>/<trace_id>.jsonl 直拼路径定位（O(1)），
        # 未命中（历史目录/手动挪动）再回退项目内按范围 glob 兜底。
        path: Path | None = None
        if project_id:
            path = self._trace_file_at(project_id, session_id, trace_id)
        if path is None:
            path = self._find_trace_file(trace_id, project_id, session_id)
        if path is None:
            return None
        events = self._read_trace_file(path)
        trace = self._pick_trace_event(events, trace_id)
        spans: list[dict[str, Any]] = []
        obs: list[dict[str, Any]] = []
        for ev in events:
            if ev.get("event_type") == _EVENT_SPAN and str(ev.get("trace_id")) == trace_id:
                spans.append(ev)
            elif ev.get("event_type") == _EVENT_OBSERVATION and str(ev.get("trace_id")) == trace_id:
                obs.append(ev)
        # OTLP 重传/分批追加可能重复同一 span；详情和调用树使用同一份去重投影。
        # id 是 span 身份，event_id 只标识事件，不能用行数计算环节数。
        spans = self._unique_spans(spans)
        if trace is None:
            # 兜底：SDK 进程在根 run 结束前被强杀/丢批时，文件里可能没有
            # trace 汇总事件（只有 session/span/observation）。此时用文件内
            # 已有事件合成一条最小 trace 记录返回，保证详情/调用树可读、
            # 已采集的 span/obs 不因缺汇总事件而无法展示。
            trace = self._synthesize_trace(events, spans, trace_id)
        if trace is None:
            return None
        trace = dict(trace)
        # 根 trace 行的计数只代表它所在的 OTLP 批次。详情已读完整文件，
        # 以实际可识别的 span 计算；不累加批次摘要，也不推算 token 用量。
        identified = all(span.get("id") for span in spans)
        trace["span_count"] = len(spans) if identified else None
        known_types = {"chain", "llm", "tool", "retriever", "agent", "span"}
        trace["tool_count"] = (
            sum(span.get("span_type") == "tool" for span in spans)
            if identified and all(span.get("span_type") in known_types for span in spans)
            else None
        )
        return TraceData(trace=trace, spans=spans, observations=obs)

    @staticmethod
    def _unique_spans(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """同一 span 保留最后一条记录；缺身份的原始记录保留但不猜唯一性。"""
        result: list[dict[str, Any]] = []
        positions: dict[str, int] = {}
        for span in spans:
            span_id = span.get("id")
            if span_id:
                key = str(span_id)
                if key in positions:
                    result[positions[key]] = span
                    continue
                positions[key] = len(result)
            result.append(span)
        return result

    async def export_trace_jsonl(
        self,
        project_id: str,
        trace_id: str,
        session_id: str | None = None,
    ) -> str | None:
        """还原下载：file 模式无需「还原」，磁盘上的 <trace_id>.jsonl 就是原文。

        按 project_id + session_id + trace_id 直拼 <pid>/<sid>/<trace_id>.jsonl
        O(1) 定位（session_id 为空落 _no_session），未命中再回退项目内按范围 glob 兜底，
        定位到文件后原样回吐全文（database 模式才需要从库表重拼行）。
        """
        path: Path | None = None
        if project_id:
            path = self._trace_file_at(project_id, session_id, trace_id)
        if path is None:
            path = self._find_trace_file(trace_id, project_id, session_id)
        if path is None:
            return None
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            return None

    def _pick_trace_event(
        self, events: list[dict[str, Any]], trace_id: str
    ) -> dict[str, Any] | None:
        """从文件事件行中挑出本 trace 的 trace 汇总事件（无则返回 None）。

        同一 trace 可能有多条 trace 事件：OTLP 上报时子 span 先到会先落一条
        shallow 占位（只有 id/event_id/project_id/status），根 span 到达后再落
        完整的一条。database 模式靠 ON CONFLICT DO UPDATE 覆盖，file 模式是
        追加写没有覆盖语义，因此这里必须挑「信息最全」的那条，否则详情页会
        读到只有 status 的占位行（name/duration/tokens 全为 null）。
        """
        best: dict[str, Any] | None = None
        best_score = -1
        for ev in events:
            if ev.get("event_type") != _EVENT_TRACE:
                continue
            tid = ev.get("trace_id") or ev.get("id")
            if str(tid) != str(trace_id):
                continue
            ev.setdefault("id", str(tid))
            # shallow 占位显式标了 trace_insert_only；其余按填充字段数打分
            score = sum(
                1
                for key in ("name", "duration_ms", "total_tokens", "agent_name", "input", "output")
                if ev.get(key) not in (None, "", 0)
            )
            if ev.get("trace_insert_only") is True:
                score = -1
            if score > best_score:
                best, best_score = ev, score
        return best

    def _synthesize_trace(
        self,
        events: list[dict[str, Any]],
        spans: list[dict[str, Any]],
        trace_id: str,
    ) -> dict[str, Any] | None:
        """从残缺文件已有事件合成最小 trace 记录（缺 trace 汇总事件的兜底）。

        触发场景：SDK 进程在根 run 结束前被强杀 / 丢批，文件里只有
        session/span/observation、没有 trace 汇总事件。此时用已有事件尽量
        还原 project_id/session_id/name/agent_name/时间等展示字段；统计类
        无法还原的置默认值，保证详情与调用树仍可展示已采集的 span/obs。
        """
        tid = str(trace_id)
        pid: str | None = None
        sid: str | None = None
        name: str | None = None
        agent_name: str | None = None
        started_at: str | None = None
        created_at: str | None = None
        tool_count = 0
        # 根 span（parent_span_id 为空）优先提供展示信息
        root_span: dict[str, Any] | None = None
        for ev in events:
            etype = ev.get("event_type")
            if str(ev.get("trace_id")) != tid:
                continue
            if etype == _EVENT_SESSION:
                pid = ev.get("project_id") or pid
                sid = ev.get("session_id") or sid
                created_at = ev.get("created_at") or created_at
                name = ev.get("name") or name
            elif etype == _EVENT_SPAN:
                pid = ev.get("project_id") or pid
                sid = ev.get("session_id") or sid
                created_at = ev.get("created_at") or created_at
                started_at = ev.get("started_at") or started_at
                if ev.get("tool_name"):
                    tool_count += 1
                if (ev.get("parent_span_id") in (None, "") and root_span is None):
                    root_span = ev
        if root_span is not None:
            name = root_span.get("name") or name
            meta = root_span.get("metadata")
            if isinstance(meta, dict):
                agent_name = meta.get("lc_agent_name")
        duration_ms = self._span_chain_duration_ms(root_span, spans)
        return {
            "id": tid,
            "event_id": None,
            "project_id": pid or "default",
            "session_id": sid,
            "name": name,
            "agent_name": agent_name,
            "input": None,
            "output": None,
            "duration_ms": duration_ms,
            "total_tokens": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "react_step_count": 0,
            "tool_count": tool_count,
            "span_count": len(spans),
            "status": "success",
            "error_info": None,
            "started_at": started_at or created_at,
            "created_at": created_at,
        }

    @staticmethod
    def _parse_ts(value: Any) -> float | None:
        """把 ISO 时间字符串转 epoch 秒（解析失败返回 None）。"""
        if not isinstance(value, str):
            return None
        try:
            return datetime.datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).timestamp()
        except (ValueError, TypeError):
            return None

    def _span_chain_duration_ms(
        self, root_span: dict[str, Any] | None, spans: list[dict[str, Any]]
    ) -> int:
        """以根 span 起点到最深 span 终点估算 duration_ms（缺失时返回 0）。"""
        if root_span is None:
            return 0
        s0 = self._parse_ts(root_span.get("started_at"))
        if s0 is None:
            return 0
        max_end = s0
        for s in spans:
            st = self._parse_ts(s.get("started_at"))
            d = s.get("duration_ms")
            if st is None or not isinstance(d, (int, float)):
                continue
            if st + d / 1000.0 > max_end:
                max_end = st + d / 1000.0
        return int(round((max_end - s0) * 1000))

    async def get_llm_request(
        self, project_id: str, event_id: str
    ) -> dict[str, Any] | None:
        return self._find_llm_request(project_id, event_id)

if __name__ == "__main__":
    list_traces("demo", 1, 20)
