# Teams × iCode × Talents

两个独立启动的演示项目，通过共享数据目录交换数据：

| 项目 | 目录 | 地址 | 负责 |
|---|---|---|---|
| iCode Teams | `teams/` | http://127.0.0.1:45970/teams | 团队协作：项目、需求、交付、验收、会话共享 |
| iCode Talents | `talents/` | http://127.0.0.1:45980/talents | 知识挖掘（Owner）：来源、知识任务、产物审阅、提交知识与改进 PR |

演示需求：信用卡消费返现，针对白金卡客户未来 3 个月的消费，额外增加 0.5% 的消费返现（DEMO-MKT-001，项目「信用卡营销交付」）。

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

Python 不是 `python3`（Windows 为 `python`）时，用 `DEMO_TRACE_PYTHON` 指定。缺少 Python 或依赖时只有该页面不可用，其余功能不受影响。

服务仅监听本机。Teams 的配置见 [快速启动](teams/docs/quick-start.md)，Talents 见 [talents/README.md](talents/README.md)。

## 数据怎么流动

```
Teams ── shared/data/teams/snapshot.json ──▶ Talents
         成员与角色、项目、代码仓、设计文档、成员共享的会话
Teams ── shared/data/teams/task-sessions/ ──▶ Talents（读取尚未实现）
         独立需求验收后自动归集的任务会话

Talents ── shared/data/talents/knowledge.json + files/ ──▶ Teams
           远端索引，以及尚未改为 PR 提交的已有知识产物

Talents ── gh（PR）──▶ 代码仓
           审阅后的知识文件、Skill 修改、AGENTS.md 规则，由开发者审阅合入
```

- 每个子目录只有一个写入方。格式定义在 [shared/contracts.ts](shared/contracts.ts)；目录可用 `DEMO_SHARED_DIR` 指定，默认 `shared/data`（不入库）。
- 成员、项目、代码仓和设计文档以 Teams 为准，在 Talents 中只读；Talents 只登记本地文档来源。
- Talents 只有管理员入口，对应 Teams Owner（挖掘、审阅、提交 PR）；Teams 只向 Owner 展示 Talents 入口。没有开发者端，开发者在代码托管平台审阅并合入 PR。
- 文件类知识和轨迹诊断建议都以 PR 提交，Talents 只保存 PR 链接和提交内容，不查询合入状态，也不直接更新 Teams 中的 Skill 版本。
- Teams「项目知识」页展示共享目录中的产物并可预览原文；任务准备只要求 Skill 可读，项目知识为空不阻止准备。
- 独立需求的输入由 Teams 组装：需求与 Skill 来自 Teams，加上共享目录中的项目知识（没有时为空）。
- 轨迹诊断与改进 PR 在 Talents 中完成，Teams 只负责共享交付会话。

## 演示主线

1. Teams：Owner 查看项目知识，从 Talents 入口进入知识挖掘。
2. Talents：文档集新增白金卡规则 → 审阅业务知识 v2 草稿 → 提交知识 PR。
3. Teams：成员准备上下文、开发、检查失败 → 修复 → 提交，Owner 验收后，Teams 自动归集交付会话并共享给 Talents。
4. Talents：用交付会话做轨迹诊断 → 逐条提交改进 PR（修改 Skill 或向 AGENTS.md 补充规则）。
5. 代码托管平台：开发者审阅并合入 PR。

## 开发边界

此仓库以隔离状态和预置数据验证交互，不连接银行支付系统，不自动调用外部模型。界面结果不能替代生产运行、模型实验或安全扫描证据。活动日期、金额舍入等测试假设见 [设计说明](teams/docs/demo-design.md)。仓内 Java/业务 Skill 快照（`workspace/`）为来源资料，不代表白金卡规则已经部署到 Java 服务。

从旧的 `demo/` 目录迁移到当前结构，见 [MIGRATION.md](MIGRATION.md)。

## 验证

```sh
npm test                                   # Teams 单元测试 + HTTP 集成 + Talents 测试
cd teams && npm run typecheck && npm run build && npm run test:e2e
cd talents && npm run typecheck && npm run build && npm run test:e2e && npm run test:codegraph:e2e
```
