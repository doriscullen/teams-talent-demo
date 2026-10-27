# iCode Talents 演示

独立启动的本机服务（Node 24+）。团队、成员、项目、代码仓、设计文档和团队共享的会话来自 iCode Teams；Talents 面向 Teams Owner：挖掘并审阅知识，文件类知识和轨迹诊断的改进建议通过 `gh` 以 PR 提交到代码仓，由开发者在代码托管平台审阅合入。索引类知识（CodeGraph 等）保留在远端，写入共享数据目录供 Teams 展示。

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
| `talents/knowledge.json` | Talents | 远端索引，以及尚未改为 PR 提交的已有产物；已提交 PR 的产物不再写入 |
| `talents/files/<产物>/v<版本>/<路径>` | Talents | 上述产物对应版本的文件 |

共享目录中缺少某个文件时，读取 `shared/seed/` 下同一路径的提交版本。修改 `server/seed.ts` 或 `content/` 后，运行 `npm run seed:shared` 重新生成 `shared/seed/talents/`。

Teams 数据在 Talents 中的对应关系：

- **角色**：只有管理员入口，对应 Teams 的 Owner（默认林悦）；Teams 只向 Owner 展示 Talents 入口。Teams 用 `/talents?role=owner#/<页面>?project=<项目>` 打开指定项目，页面为 `sources`、`tasks`、`review`。旧的 `dev-knowledge`、`knowledge`、`local` 地址转到“项目”。
- **项目**：Teams 中的项目，不显示只读导入的项目。没有本机代码仓和设计文档的项目显示为空。
- **代码仓**：Teams 项目中有本机路径的代码仓，只读。最近提交、PR 列表是 Talents 的 mock 数据。
- **文档集**：每个 Teams 项目的设计文档合成一个文档集“<项目名>文档”，只读。版本记录和最近检查由 Talents 保存；“检查更新”发现 Teams 中的文档有增删时记录新版本。
- **本地文档来源**：Talents 唯一自己登记和保存的来源（例如“银行开发规范”）。
- **会话**：Teams 中成员共享的会话，列在项目来源中；只有 Teams 已归集原文的会话可以做会话轨迹诊断。
- **项目 Skill**：Teams 项目的“项目可用 Skill”，列在项目来源中，SKILL.md 从仓库只读。会话轨迹诊断的 Skill 建议以 PR 修改代码仓中的 Skill 文件，Talents 不直接更新 Teams 中的 Skill 版本，也不查询 PR 是否合入。

Talents 自己的状态（任务、产物、PR 提交记录与提交内容、诊断建议的处理、本地文档来源、对 Teams 来源的元数据）保存在 `.runtime/state.json`（`DEMO_TALENT_STATE_DIR` 可改）。

## 提交 PR

“提交 PR”和“提交改进 PR”由服务端调用本机 `gh api` 完成，需要先 `gh auth login`，账号对目标仓库有写权限。服务端不会修改本机任何代码仓的工作区：

1. 读取目标分支的最新提交，在其上创建一个新提交（文件内容随请求一起写入 Git 树）。
2. 推到专用分支 `talents/<摘要>`，摘要由仓库、目标分支、产物、建议和文件内容算出；重试时先按分支查找已有 PR，不会重复创建。
3. 创建 PR，保存 PR 链接和提交的文件内容。之后不查询合入状态。

提交的内容：

| 来源 | 写入的文件 |
|---|---|
| 知识产物（业务知识、开发范式等） | `docs/knowledge/<产物>/<路径>`，内容为审阅后的当前版本 |
| Skill 建议 | `<仓内 Skill 目录>/<文件>`，默认目录 `.agents/skills/<Skill>`。目标文件与诊断时的内容不一致时拒绝提交 |
| 工具调用、任务指令建议 | 在仓库现有 `AGENTS.md` 末尾补充一条规则（文件不存在时新建） |

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
| `POST /api/pull-requests` | 提交 PR（`{ artifactId, suggestionId?, repository, base, note, skillDirectory? }`），成功后返回最新状态；同一产物或建议提交中时返回 409 |

## 演示脚本（约 10 分钟）

以 Owner（林悦）身份演示；顶栏左侧的系统切换选“iCode Teams”回到 Teams 中的项目。演示前确认 `gh auth status` 已登录，并准备一个可以接收 PR 的演示仓库。

1. **项目**：点进“信用卡营销交付”，在“来源”页签介绍来自 Teams 的代码仓和文档集；打开“信用卡营销交付文档”，看版本记录和“检查更新”；再看“会话与 Skill”中成员共享的会话和项目 Skill。
2. **知识能力**：按四类介绍能力，说明“更新”字段：CodeGraph、文档 RAG 检索、业务知识提取在来源变化后只处理变化的部分。
3. **知识任务**（项目的“知识任务”页签）：“历史”中有一条已完成的会话轨迹诊断，打开看产出。演示不新建诊断任务。
4. **产物管理**（项目默认打开的页签，页签上显示待审阅的产物和待提交的建议数量）：
   - 打开“信用卡营销返现业务知识”（新版本待审阅），切到“对比”，看与上次版本 v1 的差异。
   - 点“提交 PR”，填写 GitHub 仓库和目标分支，提交后右侧显示“PR 已创建”和 PR 链接，由开发者在代码托管平台审阅合入。
   - 打开“会话轨迹诊断：CardDemo 迁移与扩建（19 轮）”（卡片提示“3 条优化建议待提交”），先看诊断报告，再逐条看建议：
     - “统一 ADR Skill、模板与校验脚本的章节契约”：点“提交改进 PR”，修改仓内 Skill arch-adr-writing 的文件。
     - “为完成声明补充最终复验与数据变更披露要求”：点“提交改进 PR”，向仓库的 AGENTS.md 补充规则。
     - “现有 zsh 调用保留脚本状态并断言业务结果”：演示“暂不采纳”。
   - 打开“carddemo-java-1025 开发范式”，看范式总结、代码分析报告和 PR 资料。
   - 打开 CodeGraph 产物，看远端索引的交互图谱。
5. **团队**：团队级的来源和知识，在每个项目中都可用。
   - “来源”页签是团队登记的“银行开发规范”。
   - “产物管理”页签中的“银行编码规范要点”是团队知识；它提示“提取后文档有变化”。点“重新提取”，新建任务已预填，方式为“更新现有知识”。

演示结束后，点顶栏右侧的“重置数据”，恢复初始状态（Teams 的数据和已创建的 PR 不受影响）。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | 服务：`index.ts` 接口与静态页面，`teams-data.ts` 读取并映射 Teams 快照，`export.ts` 把远端索引等产物写入共享目录，`pull-requests.ts` 通过 `gh` 提交 PR，`store.ts` 状态存储，`seed.ts` 初始数据 |
| `src/` | 页面（React + TypeScript + Ant Design，外壳与 iCode Teams 一致）。`pages/` 下每个文件对应一个页面；`demo/` 是演示用的模拟逻辑（任务运行、产物生成、iCode 筛选会话、产物版本与差异）；`vendor/teams/` 原样复制自 `teams/src/vendor/teams` |
| `content/` | 产物与 Skill 的原文（业务知识、开发范式、轨迹诊断报告、配套 Skill） |
| `dist/` | 构建出的页面（`npm run build`），服务在 `/talents/` 提供 |
| `tools/` | `build.mjs` 构建页面；`bundle-content.mjs` 把 `content/` 打包为 `src/generated/content.json` 供页面预览产物；`seed-shared.ts` 生成 `shared/seed/talents/` |
| `tests/` | `npm test`：Teams 数据映射、状态保存、知识导出、PR 提交（模拟 `gh`）；`npm run test:e2e`：浏览器冒烟测试，PATH 中放入 `tests/fixtures/fake-gh.mjs` 代替 `gh`，不会创建真实 PR（需要 Google Chrome）；`npm run test:codegraph:e2e`：CodeGraph 图谱 |
