# Teams × iCode × Talents

两个独立启动的演示项目，通过共享数据目录交换数据：

| 项目 | 目录 | 地址 | 负责 |
|---|---|---|---|
| iCode Teams | `teams/` | http://127.0.0.1:45970/teams | 团队协作：项目、需求、交付、验收、会话共享 |
| iCode Talents | `talents/` | http://127.0.0.1:45980/talents | 知识挖掘：来源、知识任务、产物审阅与发布、开发者应用 |

演示需求：信用卡消费返现，针对白金卡客户未来 3 个月的消费，额外增加 0.5% 的消费返现（DEMO-MKT-001，项目「Credit Card」）。

## 启动

安装 Node.js 24 与 Git：

```sh
git clone https://github.com/zhuyuloveai/teams-talent-demo.git
cd teams-talent-demo
npm run setup      # 两个项目及 Teams 内嵌的 trace-monitor 各自 npm ci
npm run dev        # 构建并同时启动两边，Ctrl+C 一起停止
```

- 后台启停：`npm start` / `npm stop`（macOS 也可双击 `启动演示.command` / `停止演示.command`，Windows 用 `start-demo.cmd`）。
- 单独启动：`cd teams && npm run dev`，或 `cd talents && npm run dev`。另一边没启动时，读取 `shared/seed/` 中提交的初始数据。

「开发会话轨迹」页面另需 Python 3.10+：Teams 启动时会拉起 `teams/trace-server`（默认端口 8012）。首次运行前安装依赖：

```sh
python3 -m pip install -r teams/trace-server/requirements.txt
```

Python 不是 `python3`（Windows 为 `python`）时，用 `DEMO_TRACE_PYTHON` 指定。缺少 Python 或依赖时轨迹页面不可用，要求开启 trace 的 iCode 新作业会显示诊断。

服务仅监听本机。Teams 的配置见 [快速启动](teams/docs/quick-start.md)，Talents 见 [talents/README.md](talents/README.md)。

## 四需求预置资料

新 checkout 执行 `npm run setup`、`npm start`（或前台 `npm run dev`）后，Talents 的 Credit Card 项目产物列表和 Teams 的「项目知识」可查看以下四份模拟需求的 v1、v2 发布资料。每版包含完整原文、测试口径、业务规则、差异、实现约束、验收定义和来源摘要；Teams 按节点加载仓内真实 Skill 包。原始需求与本地测试口径是演示输入，不是生产政策签字，也不代表任何业务功能或测试已经完成。

| 业务编号 | 新建需求标题（精确匹配） |
|---|---|
| REQ-2026-001 | 信用卡账单/消费分期 |
| REQ-2026-002 | 信用卡挂失与补卡 |
| REQ-2026-003 | 信用卡额度调整申请与审批 |
| REQ-2026-004 | 交易争议在线申请与处理 |

只填写标题不会选择专用资料。服务启动后，可执行以下只读预览，复制对应 `title` 到标题、完整 `creationDescription` 到描述，在 Teams 的 Credit Card 项目手动新建需求。描述包含业务编号、原文 SHA256，以及 v2 口径版本和 SHA256，不能删掉这些标记；运行时任务 ID 由 Teams 创建。

```sh
cd talents
node --import tsx tools/register-four-requirements.ts --endpoint http://127.0.0.1:45980 --version 2
```

上述命令不带 `--apply`，仅显示资料和可复制描述，不创建任务或调用模型。新环境已自动登记两版，无需再次注册。已有有效 Talents 状态保持原样；需要增量补入资料时，先分别预览 `--version 1`、`--version 2`，核对后对相应命令追加 `--apply`。只追加缺少的来源，同 ID 内容冲突会明确拒绝。显式重置 Talents 后也包含两版预置资料；重置仍会清除 Talents 用户状态，不用于升级已有数据。

Teams 单独启动时可读取已提交的 `shared/seed/talents/`；Talents 启动后发布到 `shared/data/talents/`。这两处都保留 v1、v2，已采用的节点快照不会自动升级。正常启动只初始化资料；分配需求或确认准备会触发既有知识获取与原生会话流程，实际执行仍需本机 iCode、模型配置和工作目录。源码 ZIP 的资料读取不依赖 Git；验证 provenance 历史源码的测试需要包含来源提交的 Git clone。

## CardDemo 开发初始化

实际业务开发前，核对 **JDK 21、Maven 3.9+、Node.js 24、Git 和 Teams 实际使用的 iCode**。平台继续在 `main` 运行；使用 `npm run carddemo:workspace -- …` 为 CardDemo 建立 `develop` 和需求 worktree，先预览再执行，需求 PR 提交到 `develop`。旧目录未提交代码和已有会话保留，新工作区只取明确的 Git 基线。

初始化命令、macOS/Windows 工具核对、CLI/TUI 使用及真实测试要求见 [CardDemo 初始化与交付检查](teams/docs/carddemo-development.md)。Java 单元与服务内接口测试使用 H2；Docker/PostgreSQL 用于独立跨服务验证。当前未接通的静态分析、安全扫描须明确登记，预置结果不能替代真实单测。

## 数据怎么流动

```
Teams ── shared/data/teams/snapshot.json ──▶ Talents
         成员与角色、项目、代码仓、设计文档、成员共享的会话
Teams ── shared/data/teams/task-sessions/ ──▶ Talents（读取尚未实现）
         独立需求验收后自动归集的任务会话

Talents ── shared/data/talents/knowledge.json + files/ ──▶ Teams
           已发布的知识产物（业务知识、开发范式、轨迹诊断、索引）
```

- 每个子目录只有一个写入方。格式定义在 [shared/contracts.ts](shared/contracts.ts)；目录可用 `DEMO_SHARED_DIR` 指定，默认 `shared/data`（不入库）。
- 成员、项目、代码仓和设计文档以 Teams 为准，在 Talents 中只读；Talents 只登记本地文档来源。
- Talents 管理员端对应 Teams Owner（挖掘、审阅、发布），开发者端对应 Teams 成员（应用知识）。
- Talents 为项目发布过知识后，Teams 交付流程中的「项目知识」即视为已就绪；Teams「项目知识」页展示已发布产物并可预览原文。
- 任务输入由 Teams 按当前节点组装：需求与真实 Skill 包来自 Teams，加上 Talents 已发布的项目知识（未发布时为空），已采用版本保持固定。
- 轨迹诊断与 Skill 改进（能力演进）在 Talents 中完成，Teams 只负责共享交付会话。

## 演示主线

1. Teams：Owner 查看项目知识（Talents 已发布 v1）。
2. Talents 管理员端：文档集新增白金卡规则 → 审阅业务知识 v2 草稿 → 让 iCode 修正 BR-CASH-02 的期间边界 → 发布。
3. Teams：项目知识显示 v2；成员准备上下文、开发、检查失败 → 修复 → 提交，Owner 验收后，Teams 自动归集交付会话并共享给 Talents。
4. Talents：用当前已有共享会话做轨迹诊断（新任务会话导出后的自动读取尚未接入） → 审阅并发布 Skill 改进。
5. Talents 开发者端：应用诊断和更新后的业务知识。

## 开发边界

此仓库以隔离状态和预置数据验证交互，不连接银行支付系统。原生 iCode 准备与执行会调用本机已配置的模型，须按任务入口确认或显式 CLI 指令发起；初始化预览不启动模型。界面结果不能替代生产运行、模型实验或安全扫描证据。活动日期、金额舍入等测试假设见 [设计说明](teams/docs/demo-design.md)。仓内 Java/业务 Skill 快照（`workspace/`）为来源资料，不代表白金卡规则已经部署到 Java 服务。

从旧的 `demo/` 目录迁移到当前结构，见 [MIGRATION.md](MIGRATION.md)。

## 验证

```sh
npm test                                   # Teams 单元测试 + HTTP 集成 + Talents 测试
cd teams && npm run typecheck && npm run build && npm run test:e2e
cd talents && npm run typecheck
```
