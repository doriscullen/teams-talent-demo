"""OTLP 接收的事件落地通道（Sink）。

设计要点（见 docs/OTLP端点接收实现方案.md §8）：
- `offer()` 只入内存队列，**从不 await 网络/磁盘**，保证 HTTP 响应不被下游阻塞
- 队列满 ⇒ `offer()` 返回 False，路由层据此返回 503，让 OTel SDK 自行退避重试
- 后台 task 批量取 + `_write_batch()`；写失败只记日志，**不重试、不回队**
  （重试交给客户端，我们重试只会放大重复）
- `stop()` 在 lifespan shutdown 调用，flush 残余

通道：`kafka`（默认，耐久可重放）/ `redis` / `file` / `none`。
下游不可达时 sink 不退出，只置为「未就绪」并后台重连；未就绪期间
`offer()` 返回 False → 路由 503，下游恢复后无需重启 server。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("trace_server.otlp.sink")

_UNSAFE = re.compile(r"[^0-9A-Za-z_\-\.]")
_LONG_PATH_PREFIX = "\\\\?\\"


def _safe_segment(value: Any, fallback: str) -> str:
    if value in (None, ""):
        return fallback
    cleaned = _UNSAFE.sub("_", str(value))
    return cleaned or fallback


def _long_path(path: Path) -> Path:
    """Windows 长路径加 \\\\?\\ 前缀（复用 FileExporter 的实践）。"""
    text = str(path)
    if os.name != "nt" or text.startswith(_LONG_PATH_PREFIX) or len(text) < 200:
        return path
    if text.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + text[2:])
    return Path(_LONG_PATH_PREFIX + text)


class BaseSink(ABC):
    """所有 sink 的公共骨架：有界队列 + 后台批量刷盘。"""

    # 写失败是否说明「下游连接已不可用」；True 时置为未就绪并后台重连，
    # 期间 offer() 返回 False（503），避免继续收下又静默丢弃
    _mark_unready_on_failure = False

    def __init__(
        self,
        *,
        maxsize: int = 10000,
        batch_size: int = 200,
        flush_interval: float = 1.0,
        reconnect_interval: float = 5.0,
    ) -> None:
        self._q: asyncio.Queue[list[dict[str, Any]]] = asyncio.Queue(maxsize=maxsize)
        self._batch_size = max(1, batch_size)
        self._flush_interval = max(0.05, flush_interval)
        self._reconnect_interval = max(0.2, reconnect_interval)
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        # 下游是否可用；False 时 offer() 直接拒收（路由 503），后台按间隔重连
        self._ready = True
        self.dropped_batches = 0
        self.write_failures = 0

    # ---- 生命周期 ----

    async def start(self) -> None:
        """建立下游连接（子类可覆盖）；失败不抛，只降级为拒收。"""
        await self._on_start()
        self._closed = False
        self._task = asyncio.create_task(self._run(), name="otlp-sink")

    async def _on_start(self) -> None:  # pragma: no cover - 默认无操作
        return

    async def _reconnect(self) -> None:  # pragma: no cover - 默认无操作
        """下游不可达时的重连尝试；子类实现。"""
        return

    async def stop(self) -> None:
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        # 刷掉队列里残余的事件
        while not self._q.empty():
            try:
                batch = self._q.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover
                break
            try:
                await self._write_batch(batch)
            except Exception:
                logger.warning("OTLP sink 关闭时刷残余失败", exc_info=True)
        await self._on_stop()

    async def _on_stop(self) -> None:  # pragma: no cover - 默认无操作
        return

    # ---- 投递 ----

    def offer(self, events: list[dict[str, Any]]) -> bool:
        """非阻塞入队；队列已满或下游不可用返回 False（调用方据此回 503）。"""
        if not events:
            return True
        if self._closed or not self._ready:
            return False
        try:
            self._q.put_nowait(events)
            return True
        except asyncio.QueueFull:
            self.dropped_batches += 1
            logger.warning(
                "OTLP sink 队列已满（%d 批被拒），返回 503 让客户端重试",
                self.dropped_batches,
            )
            return False

    # ---- 后台循环 ----

    async def _run(self) -> None:
        pending: list[dict[str, Any]] = []
        while True:
            try:
                if not self._ready:
                    # 下游不可达：不消费队列（队列会被填满 → 503 让客户端退避）
                    await asyncio.sleep(self._reconnect_interval)
                    await self._reconnect()
                    continue

                batch = await asyncio.wait_for(
                    self._q.get(), timeout=self._flush_interval
                )
                pending.extend(batch)
                # 攒够一批或多批后一起写出
                while not self._q.empty() and len(pending) < self._batch_size * 5:
                    try:
                        pending.extend(self._q.get_nowait())
                    except asyncio.QueueEmpty:
                        break
                if pending:
                    await self._flush(pending)
                    pending = []
            except asyncio.TimeoutError:
                if pending:
                    await self._flush(pending)
                    pending = []
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - 防御
                logger.exception("OTLP sink 后台循环异常")
                await asyncio.sleep(0.5)

    async def _flush(self, events: list[dict[str, Any]]) -> None:
        try:
            await self._write_batch(events)
        except Exception:
            self.write_failures += 1
            logger.exception(
                "OTLP sink 写失败，丢弃 %d 条事件（由客户端重试兜底）", len(events)
            )
            if self._mark_unready_on_failure:
                # 下游连接已不可用：停掉旧连接，置为未就绪，由后台循环重连；
                # 期间 offer() 返回 False → 503，客户端会带着这批数据重投
                self._ready = False
                try:
                    await self._on_stop()
                except Exception:  # pragma: no cover - 清理失败不影响流程
                    logger.warning("OTLP sink 断开清理失败", exc_info=True)

    @abstractmethod
    async def _write_batch(self, events: list[dict[str, Any]]) -> None:
        """把一批事件写到下游。失败请抛异常，基类负责计数与日志。"""


class NilSink(BaseSink):
    """只吞不写：用于压测 / 只验协议。"""

    async def _write_batch(self, events: list[dict[str, Any]]) -> None:
        return


class FileSink(BaseSink):
    """写 JSONL，目录布局与 `trace_sdk.FileExporter` 完全一致：

        <root>/<project_id>/<session_id>/<trace_id>.jsonl
        <root>/<project_id>/_no_session/<trace_id>.jsonl

    这样 `FileBackend` 无需任何改动即可读回。
    """

    def __init__(
        self,
        root: str | Path,
        *,
        maxsize: int = 10000,
        batch_size: int = 200,
        flush_interval: float = 1.0,
        max_handles: int = 512,
    ) -> None:
        super().__init__(
            maxsize=maxsize, batch_size=batch_size, flush_interval=flush_interval
        )
        self._root = Path(root)
        self._handles: dict[str, Any] = {}
        self._handle_order: list[str] = []
        self._max_handles = max(1, max_handles)
        # trace_id -> session_id：observation 事件不带 session_id，靠所属 trace 归目录，
        # 否则同一个 trace 会分裂成 <sid>/ 和 _no_session/ 两个文件（与 FileExporter 一致）。
        self._trace_session: dict[str, str] = {}

    async def _on_start(self) -> None:
        try:
            self._root.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.exception("OTLP FileSink 无法创建目录 %s", self._root)

    def _path_for(self, ev: dict[str, Any]) -> Path | None:
        etype = ev.get("event_type")
        trace_id = ev.get("trace_id") or ev.get("id")
        if not trace_id and etype != "session":
            return None
        project_id = _safe_segment(ev.get("project_id"), "default")
        trace_seg = _safe_segment(trace_id, "unknown")
        session_id = ev.get("session_id")
        # session / trace 事件携带 session_id：建立 trace -> session 映射，
        # 后续不带 session_id 的 span / observation 据此归入同一目录。
        if session_id and etype in ("session", "trace") and trace_id:
            self._trace_session[str(trace_id)] = str(session_id)
        elif not session_id and trace_id:
            session_id = self._trace_session.get(str(trace_id))
        if session_id:
            session_seg = _safe_segment(session_id, "unknown")
            return self._root / project_id / session_seg / f"{trace_seg}.jsonl"
        return self._root / project_id / "_no_session" / f"{trace_seg}.jsonl"

    def _handle(self, path: Path) -> Any:
        path = _long_path(path)
        key = str(path)
        handle = self._handles.get(key)
        if handle is not None:
            if key in self._handle_order:
                self._handle_order.remove(key)
            self._handle_order.append(key)
            return handle

        while len(self._handles) >= self._max_handles and self._handle_order:
            old_key = self._handle_order.pop(0)
            old = self._handles.pop(old_key, None)
            if old is not None:
                try:
                    old.close()
                except OSError:
                    pass

        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a", encoding="utf-8")
        self._handles[key] = handle
        self._handle_order.append(key)
        return handle

    async def _write_batch(self, events: list[dict[str, Any]]) -> None:
        written = 0
        for ev in events:
            path = self._path_for(ev)
            if path is None:
                continue
            try:
                line = json.dumps(ev, ensure_ascii=False, default=str) + "\n"
                self._handle(path).write(line)
                written += 1
            except OSError:
                self.write_failures += 1
                self._ready = False
                logger.exception("OTLP FileSink 写入失败: %s", path)
        for handle in self._handles.values():
            try:
                handle.flush()
            except (OSError, ValueError):
                self.write_failures += 1
                self._ready = False
                logger.exception("OTLP FileSink flush 失败")
        if written:
            logger.debug("OTLP FileSink 写入 %d 条事件", written)

    async def _on_stop(self) -> None:
        for handle in self._handles.values():
            try:
                handle.close()
            except (OSError, ValueError):
                pass
        self._handles.clear()
        self._handle_order.clear()


class KafkaSink(BaseSink):
    """投递到 Kafka，消息体与 `trace_sdk.KafkaExporter` 完全一致（JSON value）。

    `key = trace_id` 让同一 trace 的事件落同一分区，天然保序；
    `acks=all` + `enable_idempotence` 保证不丢不重（重传仍由 §6.2 的 event_id 兜底）。
    """

    _mark_unready_on_failure = True

    def __init__(
        self,
        *,
        bootstrap: str,
        topic: str = "trace_topic",
        acks: str = "all",
        maxsize: int = 10000,
        batch_size: int = 200,
        flush_interval: float = 1.0,
        reconnect_interval: float = 5.0,
        connect_timeout: float = 10.0,
        producer_factory: Callable[[], Any] | None = None,
    ) -> None:
        super().__init__(
            maxsize=maxsize,
            batch_size=batch_size,
            flush_interval=flush_interval,
            reconnect_interval=reconnect_interval,
        )
        self._bootstrap = bootstrap
        self._topic = topic
        self._acks = acks
        self._connect_timeout = max(0.5, connect_timeout)
        self._producer: Any = None
        self._producer_factory = producer_factory

    def _new_producer(self) -> Any:
        if self._producer_factory is not None:
            return self._producer_factory()
        from aiokafka import AIOKafkaProducer

        return AIOKafkaProducer(
            bootstrap_servers=self._bootstrap,
            acks=self._acks,
            enable_idempotence=self._acks == "all",
            value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode(),
            key_serializer=lambda k: k.encode() if k else None,
        )

    async def _on_start(self) -> None:
        producer = None
        try:
            producer = self._new_producer()
            # broker 不可达时 aiokafka 可能长时间卡在重试，必须加超时，
            # 否则服务启动会被拖住（此时直接降级为拒收）
            await asyncio.wait_for(producer.start(), timeout=self._connect_timeout)
        except Exception:
            self._ready = False
            self._producer = None
            if producer is not None:
                try:
                    await producer.stop()
                except Exception:  # pragma: no cover - 清理失败不影响降级
                    pass
            logger.warning(
                "OTLP KafkaSink 连接 %s 失败，暂拒收并每 %.0fs 重连"
                "（客户端会收到 503 并自行退避）",
                self._bootstrap,
                self._reconnect_interval,
                exc_info=True,
            )
            return
        self._producer = producer
        self._ready = True
        logger.info("OTLP KafkaSink 已连接 %s（topic=%s）", self._bootstrap, self._topic)

    async def _reconnect(self) -> None:
        await self._on_start()

    async def _write_batch(self, events: list[dict[str, Any]]) -> None:
        if self._producer is None:
            raise RuntimeError("kafka producer 未就绪")
        for ev in events:
            key = str(ev.get("trace_id") or ev.get("id") or "")
            await self._producer.send(self._topic, key=key, value=ev)
        await self._producer.flush()

    async def _on_stop(self) -> None:
        producer, self._producer = self._producer, None
        if producer is None:
            return
        try:
            await producer.flush()
        except Exception:  # pragma: no cover - 关闭期异常只记录
            logger.warning("OTLP KafkaSink flush 失败", exc_info=True)
        try:
            await producer.stop()
        except Exception:  # pragma: no cover
            logger.warning("OTLP KafkaSink 关闭失败", exc_info=True)


class RedisSink(BaseSink):
    """XADD 到 Redis Stream，字段 `data` 与 `trace_sdk.RedisExporter` 逐字节一致。"""

    _mark_unready_on_failure = True

    def __init__(
        self,
        *,
        url: str,
        topic: str = "trace_topic",
        maxsize: int = 10000,
        batch_size: int = 200,
        flush_interval: float = 1.0,
        reconnect_interval: float = 5.0,
        connect_timeout: float = 10.0,
        client: Any = None,
    ) -> None:
        super().__init__(
            maxsize=maxsize,
            batch_size=batch_size,
            flush_interval=flush_interval,
            reconnect_interval=reconnect_interval,
        )
        self._url = url
        self._topic = topic
        self._connect_timeout = max(0.5, connect_timeout)
        self._client = client

    async def _connect(self) -> Any:
        if self._client is not None:
            return self._client
        import redis.asyncio as aioredis

        client = aioredis.from_url(self._url, decode_responses=False)
        await client.ping()
        return client

    async def _on_start(self) -> None:
        try:
            self._client = await asyncio.wait_for(
                self._connect(), timeout=self._connect_timeout
            )
        except Exception:
            self._client = None
            self._ready = False
            logger.warning(
                "OTLP RedisSink 连接失败，暂拒收并每 %.0fs 重连"
                "（客户端会收到 503 并自行退避）",
                self._reconnect_interval,
                exc_info=True,
            )
            return
        self._ready = True
        logger.info("OTLP RedisSink 已连接（topic=%s）", self._topic)

    async def _reconnect(self) -> None:
        await self._on_start()

    async def _write_batch(self, events: list[dict[str, Any]]) -> None:
        if self._client is None:
            raise RuntimeError("redis 客户端未就绪")
        pipe = self._client.pipeline()
        for ev in events:
            pipe.xadd(self._topic, {"data": json.dumps(ev, ensure_ascii=False)})
        await pipe.execute()

    async def _on_stop(self) -> None:
        client, self._client = self._client, None
        if client is None:
            return
        try:
            await client.aclose()
        except Exception:  # pragma: no cover
            logger.warning("OTLP RedisSink 关闭失败", exc_info=True)


def _batch_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    keys = ("maxsize", "batch_size", "flush_interval")
    return {k: kwargs[k] for k in keys if kwargs.get(k) is not None}


def _reconnect_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    keys = ("reconnect_interval", "connect_timeout")
    return {k: kwargs[k] for k in keys if kwargs.get(k) is not None}


def build_sink(sink_kind: str = "", **kwargs: Any) -> BaseSink:
    """按 OTLP_SINK 构造 sink 实例（未显式传入的连接参数从 config 取）。"""
    kind = (sink_kind or "").strip().lower()
    batch = _batch_kwargs(kwargs)
    net = {**batch, **_reconnect_kwargs(kwargs)}

    if kind == "none":
        return NilSink(**batch)
    if kind == "file":
        root = kwargs.get("root")
        if root in (None, ""):
            from config import OTLP_FILE_DIR

            root = OTLP_FILE_DIR
        return FileSink(root, **batch)
    if kind == "kafka":
        from config import (
            OTLP_KAFKA_ACKS,
            OTLP_KAFKA_BOOTSTRAP,
            OTLP_KAFKA_TOPIC,
        )

        return KafkaSink(
            bootstrap=kwargs.get("bootstrap") or OTLP_KAFKA_BOOTSTRAP,
            topic=kwargs.get("topic") or OTLP_KAFKA_TOPIC,
            acks=kwargs.get("acks") or OTLP_KAFKA_ACKS,
            producer_factory=kwargs.get("producer_factory"),
            **net,
        )
    if kind == "redis":
        from config import OTLP_REDIS_TOPIC, OTLP_REDIS_URL

        return RedisSink(
            url=kwargs.get("url") or OTLP_REDIS_URL,
            topic=kwargs.get("topic") or OTLP_REDIS_TOPIC,
            client=kwargs.get("client"),
            **net,
        )
    raise RuntimeError(f"未知的 OTLP_SINK: {sink_kind!r}")
