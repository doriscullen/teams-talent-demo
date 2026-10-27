# 快速启动

需要 Node.js 24、npm 和 Git。进入 teams 目录：

```sh
npm ci
npm run dev
```

Teams：http://127.0.0.1:45970/teams。Ctrl+C 停止。状态保存在忽略目录 .runtime，重启保留。Talents 是独立项目（仓库根目录的 talents/，http://127.0.0.1:45980/talents），两者通过共享数据目录 shared/data 交换数据；在仓库根目录执行 `npm run dev` 可同时启动两边。

「开发会话轨迹」页面内嵌 trace-monitor，并由 Teams 拉起 Python 的 trace-server（默认端口 8012）。仓库根目录的 `npm run setup` 与启动脚本会安装 trace-monitor 依赖；单独在 teams 目录运行时，先执行 `npm ci --prefix trace-monitor`。Python 依赖需手动安装一次：`python3 -m pip install -r trace-server/requirements.txt`；解释器不是 `python3`（Windows 为 `python`）时用 DEMO_TRACE_PYTHON 指定。缺少这些依赖时轨迹页面不可用，要求开启 trace 的 iCode 新作业会显示诊断。

Windows 可运行仓库 start-demo.cmd；macOS 可运行仓库启动/停止 command 文件。原生工具可选，不是网页运行的前提。未设置 `DEMO_ICODE_BINARY` 时会依次查找官方安装位置（Windows `%LOCALAPPDATA%\chrys\bin\icode.exe`，macOS/Linux `~/.local/bin/icode`）和仓库开发包；显式路径仍优先。Agent 管理的「引擎定位」展示原生入口、版本、配置目录与会话根。配置自己的可执行文件时使用 DEMO_ICODE_BINARY 或 DEMO_OPENCODE_BINARY，不在仓库提交密钥。

## 操作顺序

Owner 在项目概览关联资产，在任务管理中分配需求。进入任务交付页后，Teams 按项目、任务和当前节点筛选共享目录中 Talents 写入的知识（没有时为空，不阻止准备）与真实版本 Skill 包；页面与 CLI 读取同一结果，采用前属于建议输入。任务按“我的任务 / 其他任务”分组，项目内可共同浏览，仅当前交付人可执行，Owner 也可承担任务；MKT-001 与新增交付需求共用需求澄清、功能开发、测试验证、需求验收四节点，按输入、结果、执行过程展示；结果列出本节点交付物和完成标准。iCode 通过 Teams CLI 明确采用输入后，提交 PRD 与澄清完成标准，再进入开发。设计、代码 PR／提交、单测和功能／检视／安全报告使用可追踪的产物引用与代码版本；上游引用在下游原样复用。开发、检查结果和进度也只由 CLI 回传；页面切换节点不推进状态。执行过程上部是 CLI 主动回传的业务进展，下部按真实用户轮次只读刷新已保存的用户输入与模型可见回复，不展示隐藏思考、Hook 或工具流水；会话活动不自动变成业务进度。预置检查明确标注来源，同批任一失败都不能提交验收，Owner 退回后必须重新检查。Owner 验收通过后，Teams 自动归集前面节点关联的一个或多个会话，写入共享目录 `shared/data/teams/task-sessions`；页面分别展示验收状态和共享回执。Talents 消费这些会话的分析链路尚未接入；共享成功不表示已分析，不作为本次任务完成条件。Talents 只对 Owner 开放：远端索引等产物写入共享目录，Teams 在项目知识中展示；文件类知识和改进建议由 Talents 以 PR 提交到代码仓。

UI 沿产品页面操作，不会发生真实支付。用户确认独立需求的 iCode 作业后，将使用所选终端打开本机 iCode TUI；输入工作指令时附带当前节点上下文入口，由开发者决定交互和是否继续后续节点。不会自动串行完成整项需求；普通页面访问及仅打开 TUI 不会提交模型任务。检查记录区分实际执行与预置结果，生产安全状态未验证。

## 验证命令

```sh
npm run typecheck
npm test
npm run build
npm run test:http
```

浏览器脚本需要额外 Chrome 运行环境；只有实际执行的检查才可声明通过。工作区旧状态与当前活动冲突时，由 Owner 使用重置工作区重新开始；不会重写源码或原生会话。

## CLI

```sh
node scripts/teams-demo.mjs --help
node scripts/teams-demo.mjs context get --project carddemo --task DEMO-MKT-001 --node prepare
```

CLI 仅连接明确的本机服务，并要求项目、任务和节点上下文。

## 本机持久配置

在同一 Git 仓库的 `teams` 中开发与运行：`npm run dev` 用于前台运行，`npm run launch` / `npm run stop` 用于后台启停，并核对当前目录的服务归属。新作业和 Skill 源文件默认来自该仓库的 `workspace`，不依赖另一份应用副本。

本机配置放在被 Git 忽略的 `teams/.local/config.json`，启动、停止、服务和 Teams CLI 共用；显式 shell 环境变量优先。默认文件缺失使用原默认值；显式指定的文件缺失、损坏 JSON、未知键和错误类型直接报错。路径键 `DEMO_MATERIAL_ROOT`、`DEMO_STATE_DIR`、`DEMO_SHARED_DIR`（共享数据目录，默认 ../shared/data）、`DEMO_ICODE_BINARY`、`DEMO_ICODE_PYTHON`、`DEMO_OPENCODE_BINARY` 均须为绝对路径；端口键 `DEMO_PORT`、`DEMO_TALENT_PORT` 须为 1024–65535 的 JSON 整数。绝对路径环境变量 `DEMO_LOCAL_CONFIG` 可选择独立配置文件，用于隔离运行与测试。

Teams 状态可放在 `.local/state/teams`。独立 Talents 使用自己的 `.runtime` 或配置目录；旧 Talent 的状态与回执原样保留，不能直接交给新 Talents Store。Teams CLI 默认回执随 Teams 状态目录保存。iCode 与其 Python 可指向仓库外的安装位置。不要把整个材料根目录指向旧运行副本。当前产品仅提供新作业入口；原生历史会话保持原位置，迁移备份仅保存在本机；不会自动迁移或重写。

旧 MKT-001 数据在启动时执行一次明确迁移：先将原状态逐字节备份到同目录的 `state.json.pre-unified-delivery.json`，再建立保留原任务 ID 的统一交付记录。旧顶层状态、上下文、交易和会话证据保持原样，历史预置结果不会被标为新的 iCode 执行。后续启动不重复迁移。

## iCode TUI 与 trace

Windows 与 macOS 均以可交互 TUI 启动，沿用 Agent 管理中的终端及本机 Agent/模型配置。当前节点上下文通过两条仅在 Teams 作业进程中生效的原生 Hook 带入；安装前备份已有 Hooks，保留其他规则。首次输入后仍须由 iCode 读取并通过 Teams CLI 明确采用，打开终端不等于已读取或已完成。`icode run --task ... --json` 仅保留为显式自动验证工具，不是页面默认启动方式。

本次作业使用 OTLP/HTTP trace，默认本机 `http://127.0.0.1:8012/v1/traces`。已有本机接收器可通过 `DEMO_TRACE_ENDPOINT`（环境变量或本机配置）指定；仅允许本机 HTTP 接收地址。启动前检查接收端，实际接收需查看接收记录，不能以健康检查代替。只启用 trace，清除继承的其他日志/指标出口及认证头。参照启动脚本，`CHRYS_OTEL_SENSITIVE_DATA` 缺省为 `true`，这会在本机 trace 保存输入、模型回复和工具参数；本机显式值保留，可在启动服务前设为 `false`。这些配置只影响本次新 TUI 子进程，不修改全局模型或其他会话。

Owner 验收时，无需关闭仍在使用的 TUI：Teams 核验该任务的原生会话归属，固定当时已落盘正文及摘要，重试使用同一快照。会话后续交互不会改变这次验收上报；验收结论、TUI 退出状态与 共享导出状态分别记录。

Trace 预检使用当前 iCode 自身的 Python，不能用系统里另一个 Python 代替。某些 iCode 0.31 安装只有 OpenTelemetry SDK，缺少 HTTP exporter。先用 `DEMO_ICODE_PYTHON` 指向原生运行时，再检查 `"<iCode Python>" scripts/native/check-trace-runtime.py`；若缺包，为同一环境安装与输出 `sdkVersion` 相同版本的 `opentelemetry-exporter-otlp-proto-http`，例如 `uv pip install --python "<iCode Python>" "opentelemetry-exporter-otlp-proto-http==1.45.1" "opentelemetry-sdk==1.45.1"`。Windows PowerShell 在带引号的可执行路径前加 `&`。保持已有包版本，安装前保存包清单；启动会明确显示缺失或版本不匹配，不会静默关闭 trace。

Trace 在 Teams「开发会话轨迹」页面查看，由 Python trace-server 接收并提供 `/api/v1` 查询接口。任务交付页只展示用户输入与模型可见回复，工具调用细节保留在独立轨迹页。
