"""FastAPI 应用入口：路由注册 + CORS + 生命周期。"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import (
    OTLP_BATCH_SIZE,
    OTLP_ENABLED,
    OTLP_FILE_DIR,
    OTLP_FLUSH_INTERVAL,
    OTLP_PATH,
    OTLP_QUEUE_SIZE,
    OTLP_PATH,
    OTLP_RECONNECT_INTERVAL,
    OTLP_SINK,
    STORAGE_BACKEND,
)
from db.connection import close_engine, init_engine
from .routes import otlp, traces
from .schemas import ConfigOut

logger = logging.getLogger("trace_server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if STORAGE_BACKEND == "database":
        init_engine()

    # OTLP 接收通道（与 STORAGE_BACKEND 解耦，由 OTLP_SINK 独立决定）
    if OTLP_ENABLED:
        from otlp import build_sink

        app.state.otlp_sink = build_sink(
            OTLP_SINK,
            root=OTLP_FILE_DIR,
            maxsize=OTLP_QUEUE_SIZE,
            batch_size=OTLP_BATCH_SIZE,
            flush_interval=OTLP_FLUSH_INTERVAL,
            reconnect_interval=OTLP_RECONNECT_INTERVAL,
        )
        await app.state.otlp_sink.start()
        logger.info("OTLP 接收已启用：path=%s sink=%s", OTLP_PATH, OTLP_SINK)
        if OTLP_SINK in ("kafka", "redis") and STORAGE_BACKEND == "file":
            logger.warning(
                "OTLP_SINK=%s 但 STORAGE_BACKEND=file："
                "数据会写入数据库而查询读取文件，前端将看不到这些 trace",
                OTLP_SINK,
            )

    yield

    if OTLP_ENABLED:
        sink = getattr(app.state, "otlp_sink", None)
        if sink is not None:
            await sink.stop()
            app.state.otlp_sink = None
    if STORAGE_BACKEND == "database":
        await close_engine()


app = FastAPI(title="Trace Monitor API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = "/api/v1"


@app.get("/api/v1/config", response_model=ConfigOut)
async def get_config():
    """返回当前存储后端模式（file/database），供前端据此显示/隐藏功能。"""
    return ConfigOut(storageBackend=STORAGE_BACKEND)


app.include_router(traces.router, prefix=api_prefix, tags=["traces"])

if OTLP_ENABLED:
    app.include_router(otlp.router, tags=["otlp"])


@app.get("/health")
async def health():
    sink = getattr(app.state, "otlp_sink", None)
    ready = bool(OTLP_ENABLED and OTLP_PATH == "/v1/traces" and OTLP_SINK == "file" and sink is not None and sink._ready and not sink._closed and not sink.write_failures)
    return JSONResponse(status_code=200 if ready else 503, content={
        "status": "ok" if ready else "error", "app": "teams-trace-server",
        "service": "trace", "protocol": "otlp/http-protobuf", "pid": os.getpid(),
        "workspaceRoot": str(Path(os.environ.get("TEAMS_TRACE_WORKSPACE_ROOT", Path(__file__).resolve().parents[3])).resolve()),
        "stateRoot": str(Path(OTLP_FILE_DIR).resolve()),
    })
