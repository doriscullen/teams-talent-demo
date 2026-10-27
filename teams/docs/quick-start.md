# 快速启动

需要 Node.js 24、npm 和 Git。进入 teams 目录：

```sh
npm ci
npm run dev
```

Teams：http://127.0.0.1:45970/teams。Ctrl+C 停止。状态保存在忽略目录 .runtime，重启保留。Talents 是独立项目（仓库根目录的 talents/，http://127.0.0.1:45980/talents），两者通过共享数据目录 shared/data 交换数据；在仓库根目录执行 `npm run dev` 可同时启动两边。

「开发会话轨迹」页面内嵌 trace-monitor，并由 Teams 拉起 Python 的 trace-server（默认端口 8012）。仓库根目录的 `npm run setup` 与启动脚本会安装 trace-monitor 依赖；单独在 teams 目录运行时，先执行 `npm ci --prefix trace-monitor`。Python 依赖需手动安装一次：`python3 -m pip install -r trace-server/requirements.txt`；解释器不是 `python3`（Windows 为 `python`）时用 DEMO_TRACE_PYTHON 指定。缺少这些依赖时只有该页面不可用。

Windows 可运行仓库 start-demo.cmd；macOS 可运行仓库启动/停止 command 文件。原生工具可选，不是网页运行的前提。配置自己的可执行文件时使用 DEMO_ICODE_BINARY 或 DEMO_OPENCODE_BINARY，不在仓库提交密钥。

## 操作顺序

Owner 在项目概览关联资产，在任务管理中分配需求。成员进入任务交付页后，Teams 自动读取该任务的需求与 Skill，以及共享目录中 Talents 写入的项目知识（没有时为空，不阻止准备）；成员确认上下文并启动 iCode，开发、检查结果和进度通过 Teams CLI 回传。Owner 验收通过后，Teams 自动归集前面节点关联的一个或多个会话，写入共享目录 shared/data/teams/task-sessions 供 Talents 读取；页面分别展示验收状态和共享回执。Talents 读取这些会话做轨迹诊断尚未接入，不作为本次任务完成条件。Talents 只对 Owner 开放：远端索引写入共享目录，Teams 在项目知识中展示；文件类知识和改进建议由 Talents 以 PR 提交到代码仓。

UI 沿产品页面操作，不会发生真实支付。用户确认独立需求的 iCode 作业后，将调用本机 iCode 和当前配置的模型执行任务；普通页面访问不会启动模型。检查记录区分实际执行与预置结果，生产安全状态未验证。

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

`DEMO_TALENT_STATE_DIR` 为旧键，仍可保留但已不使用。可将状态放在 `.local/state/teams` 并配置 `DEMO_STATE_DIR`；Teams CLI 默认回执随 Teams 状态目录保存。iCode 与其 Python 可指向仓库外的安装位置。不要把整个材料根目录指向旧运行副本。当前产品仅提供新作业入口；原生历史会话保持原位置，迁移备份仅保存在本机；不会自动迁移或重写。
