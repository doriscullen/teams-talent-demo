# iCode Talents 演示

独立启动的本机服务（Node 24+）。团队、成员、项目、代码仓、设计文档和团队共享的会话来自 iCode Teams；Talents 挖掘、审阅并发布知识，发布的知识写回共享数据目录，供 Teams 读取。

```bash
cd talents
npm install
npm run dev        # 构建页面（dist/）并启动，打开 http://127.0.0.1:45980/talents
```

设计说明见 [DESIGN.md](DESIGN.md)。

## 与 iCode Teams 的数据交换

数据格式见 `shared/contracts.ts`，共享数据目录默认是仓库根目录的 `shared/data/`（`DEMO_SHARED_DIR` 可改）。

| 文件 | 写入方 | 内容 |
|---|---|---|
| `teams/snapshot.json` | Teams | 团队成员（owner / member）、项目及其代码仓和设计文档、共享会话 |
| `talents/knowledge.json` | Talents | 只含已发布的产物 |
| `talents/files/<产物>/v<版本>/<路径>` | Talents | 已发布版本的文件 |

共享目录中缺少某个文件时，读取 `shared/seed/` 下同一路径的提交版本。修改 `server/seed.ts` 或 `content/` 后，运行 `npm run seed:shared` 重新生成 `shared/seed/talents/`。

Teams 数据在 Talents 中的对应关系：

- **角色**：管理员端是 Teams 的 Owner（默认林悦），开发者端是 Teams 成员（默认 `member`，陈晨）。Teams 可以用 `/talents?role=owner|member#/<页面>?project=<项目>` 打开指定入口和项目，页面为 `sources`、`tasks`、`review`、`dev-knowledge`。
- **项目**：Teams 中的项目，不显示只读导入的项目。没有本机代码仓和设计文档的项目显示为空。
- **代码仓**：Teams 项目中有本机路径的代码仓，只读。最近提交、PR 列表是 Talents 的 mock 数据。
- **文档集**：每个 Teams 项目的设计文档合成一个文档集“<项目名>文档”，只读。版本记录和最近检查由 Talents 保存；“检查更新”发现 Teams 中的文档有增删时记录新版本。
- **本地文档来源**：Talents 唯一自己登记和保存的来源（例如“银行开发规范”）。
- **会话**：会话轨迹诊断使用 Teams 中成员共享的会话。

Talents 自己的状态（任务、产物、修订、发布、开发者应用记录、本地文档来源、对 Teams 来源的元数据）保存在 `.runtime/state.json`（`DEMO_TALENT_STATE_DIR` 可改）。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `DEMO_TALENT_PORT` | 45980 | Talents 端口 |
| `DEMO_PORT` | 45970 | Teams 端口，用于“返回 iCode Teams”链接 |
| `DEMO_SHARED_DIR` | `<仓库>/shared/data` | 共享数据目录 |
| `DEMO_TALENT_STATE_DIR` | `talents/.runtime` | Talents 状态目录 |

也可以写在 `talents/.local/config.json`（格式与 `teams/.local/config.json` 相同，`DEMO_LOCAL_CONFIG` 可指定其他文件）。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 服务信息 |
| `GET /api/bootstrap` | Talents 状态合并 Teams 数据（团队、项目、来源、会话），以及 Teams 地址 |
| `PUT /api/state` | 保存页面上的状态（`{ revision, state }`，按 revision 检查冲突）。服务端去掉来自 Teams 的部分，只保存 Talents 自己的数据，然后更新共享目录中的知识 |
| `POST /api/reset` | 恢复初始数据 |

## 演示脚本（约 15 分钟）

顶栏右侧可以在“管理员端”和“开发者端”之间切换，模拟两台电脑上的两个入口；顶栏左侧的系统切换选“iCode Teams”回到 Teams 中的项目。

**管理员端（林悦）**

1. **项目**：点进“信用卡营销交付”，在“来源”页签介绍来自 Teams 的代码仓和文档集；打开“信用卡营销交付文档”，看版本记录和“检查更新”。
2. **知识能力**：按四类介绍能力，说明“更新”字段：CodeGraph、文档 RAG 检索、业务知识提取在来源变化后只处理变化的部分。
3. **知识任务**（项目的“知识任务”页签）：
   - 新建任务，能力选“会话轨迹诊断”，点“选择会话…”。
   - 在弹窗中让 iCode 筛选“对话轮次超过 50 的会话”，点“全部选中”，再“确定”。
   - 创建并运行，看进度；完成后点“去审阅”。
4. **产物审阅**（项目的“产物审阅”页签，页签上显示待审阅的数量）：
   - 打开“信用卡营销返现业务知识”（新版本待审阅），切到“对比”，看与线上 v1 的差异。
   - 点“发布”，发布到这个项目；交付方式保持“同步到本地”，适用智能体保持“全部智能体”，更新说明已自动填好。
   - 打开刚生成的会话轨迹诊断，看诊断报告和 Skill 改进建议，然后发布。
   - 打开“carddemo-java-1025 开发范式”，看范式总结、代码分析报告和 PR 资料。
5. **团队**：团队级的来源和知识，在每个项目中都可用。
   - “来源”页签是团队登记的“银行开发规范”。
   - “产物审阅”页签中的“银行编码规范要点”是团队知识，适用 Code Agent 和代码评审助手；它提示“提取后文档有变化”。点“重新提取”，新建任务已预填，方式为“更新现有知识”。

**开发者端（陈晨）**

6. **项目知识**：
   - “信用卡营销返现业务知识”显示“有更新”和管理员写的更新说明，点“更新”。
   - 对刚发布的轨迹诊断点“应用”，再点“查看改动”，说明会写到哪里。
   - 用“⋯”菜单演示修改范围和撤销。
7. **本地索引**：为本机的代码仓建立索引，并应用到 iCode。

演示结束后，点顶栏右侧的“重置数据”，恢复初始状态（Teams 的数据不受影响）。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | 服务：`index.ts` 接口与静态页面，`teams-data.ts` 读取并映射 Teams 快照，`export.ts` 发布知识到共享目录，`store.ts` 状态存储，`seed.ts` 初始数据 |
| `src/` | 页面（React + TypeScript + Ant Design，外壳与 iCode Teams 一致）。`pages/` 下每个文件对应一个页面；`demo/` 是演示用的模拟逻辑（任务运行、产物生成、iCode 筛选会话、产物版本与应用改动）；`vendor/teams/` 原样复制自 `teams/src/vendor/teams` |
| `content/` | 产物与 Skill 的原文（业务知识、开发范式、轨迹诊断报告、配套 Skill） |
| `dist/` | 构建出的页面（`npm run build`），服务在 `/talents/` 提供 |
| `tools/` | `build.mjs` 构建页面；`bundle-content.mjs` 把 `content/` 打包为 `src/generated/content.json` 供页面预览产物；`seed-shared.ts` 生成 `shared/seed/talents/` |
| `tests/` | `npm test`：Teams 数据映射、状态保存、知识导出；`npm run test:e2e`：浏览器冒烟测试（需要 Google Chrome） |
