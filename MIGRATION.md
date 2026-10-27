# 迁移指南：基于旧 demo/ 的分支合入新结构

适用对象：分支从旧 `main`（`demo/` 目录，Teams 与 Talent 在同一个项目里）拉出、尚未合入的开发者。

`main` 现在的结构：

- `teams/`：原 `demo/` 改名后去掉 Talent 部分。页面、交付流程和状态结构基本不变。
- `talents/`：独立的 Talents 项目，前端为 React + TS + Ant Design（外壳与 Teams 一致），服务端为 Node + TS。
- `shared/`：两个项目交换数据的格式（`contracts.ts`）和初始数据（`seed/`）。

## 一、合并步骤

**一定要分两步合并。** 如果直接合并 `main`，被大幅改写的文件（例如 `project-knowledge.tsx`）git 识别不出是改名，会报 `modify/delete` 冲突，你的修改会留在已不存在的 `demo/` 路径下。先单独合并改名提交，就不会有这个问题。

```sh
git fetch origin
# 1. 找到并合并“只改目录名”的提交
RENAME=$(git log origin/main --format=%H -n1 --grep='^Rename demo directory to teams$')
git merge "$RENAME"
# 2. 再合并 main 的其余改动
git merge origin/main
```

用 rebase 时同样分两步：`git rebase "$RENAME"`，再 `git rebase origin/main`。

**第 1 步的结果：**

- 你修改过的 `demo/...` 文件会自动跟到 `teams/...`。
- 你**新增**的文件也会被放到 `teams/` 下对应位置，但 git 会报 `CONFLICT (file location): demo/... suggesting it should perhaps be moved to teams/...`。确认位置无误后，执行 `git add teams/<该文件>`，再提交即可。

**第 2 步可能出现内容冲突的文件**，按普通冲突处理，以 main 的结构为准，再移植你的改动：

| 文件 | main 上的变化 |
|---|---|
| `teams/src/components/project-knowledge.tsx` | 重写：改为展示 Talents 发布的产物，支持预览原文 |
| `teams/src/main.tsx` | 去掉 Talent 页面、侧栏和 `isTalent` 分支 |
| `teams/server/index.ts` | 去掉 Talent 集成接口；新增共享数据导出、知识同步，以及 `/api/talents/knowledge`、`/api/talents/file` |
| `teams/src/components/enterprise-source-data.tsx` | 去掉「业务知识（Talent）」分支 |
| `teams/src/api.ts`、`teams/src/system-links.ts` | 请求只发往 Teams；`talentLink` 改为跳转独立的 Talents |
| `teams/src/source-plugins.ts`、`external-platforms.ts`、`pages/organization.tsx` | 删除 `business-knowledge` 来源和 Talent 接入页签；ADR-009/ADR-007 改指真实 ADR |
| `teams/server/collaboration-service.ts` | 项目知识改为从共享目录读取 |
| `teams/package.json`、`package-lock.json` | 新增依赖 `marked`，删除 `*:talent` 脚本。lock 冲突时取 main 的版本，再执行 `npm install` |
| `teams/server/talent-intake.ts` | 删除 `TalentTaskIntakeService` 与需求登记；改为 `sharedTaskInputs()`、`exportTaskSessions()` |
| `teams/server/task-automation.ts` | 验收后的会话写入共享目录，不再 POST 到 Talent |
| `teams/src/talent-contract.ts` | 只保留任务输入与会话共享的类型；知识条目改为 `TaskKnowledgeAsset`，删除 `TalentTaskInputRegistration` |
| `start-demo.cmd` | 改为在仓库根目录启动两边，trace 依赖路径改为 `teams\...` |

**如果你改过下列已删除的文件**，会出现 `modify/delete` 冲突：

- `server/talent.ts`、`talent-store.ts`、`talent-integration.ts`、`talent-knowledge.ts`
- `src/pages/talent.tsx`、`talent.css`、`talent-contract.ts`、`talent-artifacts.ts`

`talent-contract.ts` 例外：它仍在 `teams/src/` 下，冲突时以 main 的版本为准，再移植你的改动。

**如果你新增或改过 trace 相关文件**（`demo/trace-monitor/`、`demo/trace-server/`），它们已移到 `teams/trace-monitor/`、`teams/trace-server/`，按第 1 步的 `CONFLICT (file location)` 处理。

Talents 的功能已移到 `talents/` 项目，技术栈不同，需要在那边重新实现，或者和 Talents 的维护人确认后再放弃这部分改动。

## 二、合并后的本机调整

1. 被 git 忽略的本机文件不会随合并移动，需要手动挪：
   - `demo/.local/config.json` → `teams/.local/config.json`
   - `demo/.runtime/` → `teams/.runtime/`。原有交付状态可以继续使用。
   - 旧的 `demo/.talent-runtime/` 已不再使用。
2. 在 `teams/` 下执行 `npm ci`；如果要同时运行 Talents，在仓库根目录执行 `npm run setup`。
3. 代码、文档、fixture 中写死的 `demo/...` 路径改为 `teams/...`。
4. 已有的 trace 数据 `demo/trace-server/trace_data/` 挪到 `teams/trace-server/trace_data/`。trace-monitor 依赖由 `npm run setup` 和启动脚本安装；Python 依赖见 README。

### 已有原生会话

迁移前先停止属于当前目录的服务，并备份本机状态。`demo/.local` 需要整体移动到 `teams/.local`，再修正本机配置中的 Teams 状态路径。旧 Talent 的状态和接收回执保留原样；独立 Talents 使用自己的状态目录，不能把旧状态文件直接交给新 Store。

历史会话中的 manifest、任务文件和采用依据保留原字节。对于确实随 runtime 搬迁的原生会话，在 `teams/` 下显式登记旧、新运行目录和 run 清单：

```sh
node --import tsx scripts/migrate-native-session-location.ts \
  --runtime /absolute/new/teams-runtime \
  --previous-runtime /absolute/old/teams-runtime \
  --runs RUN_UUID_1,RUN_UUID_2
```

默认只预检；确认清单后加 `--apply yes`，写入本机迁移映射。读取时核验 run、任务、节点、session 以及原 manifest/归属文件的 SHA256；路径不匹配、损坏和权限错误直接失败。没有会话正文的失败启动仍显示原失败状态，不生成对话或完成记录。

任务登记的历史 `workDirectory` 同样保留。新启动可使用状态目录中的 `project-task-directory-bindings.json`：每条绑定显式记录项目、任务、原登记目录、新 Git 根和 Git 配置 SHA256，启动时重新核验。该本机映射不修改历史任务上下文或已采用版本。

## 三、接口变化对照

| 原来 | 现在 |
|---|---|
| Talent 服务（45980）与 `/api/integrations/talent/*` | 删除。Teams 只与共享目录交互（`teams/server/shared-data.ts`）：启动时及每次写操作成功后，导出 `shared/data/teams/snapshot.json`；从 `shared/data/talents/` 读取已发布的知识，缺失时读取 `shared/seed/`。需要提供给 Talents 的新数据，加到 `shared/contracts.ts` 的 `TeamsSnapshot`，并在 `teamsSnapshot()` 中导出 |
| Owner 点「发起项目知识整合」，即 `perform('knowledge')` | 按钮已删除，`POST /api/action {action:'knowledge'}` 返回 400。Talents 为 `carddemo` 发布知识后，`GET /api/state` 和 `/api/bootstrap` 会自动执行 `knowledge` 转换（审计记录的 system 仍为 `Teams`，detail 为「Talents 已发布项目知识：…」）。读取 `state.knowledge`，以及新增的 `state.knowledgeVersion`（如「信用卡营销返现业务知识 v2」）。领域层的 `transition(state, 'knowledge', role, { knowledgeVersion? })` 仍可直接调用 |
| `candidate` / `evaluate` / `release` / `adopt`、`'analysis.run'` | `Action`、`WorkspaceAction` 类型，以及 `state.evolution`、`workspace.analysis` 字段都保留，但服务端返回 400（能力演进与轨迹分析已迁到 Talents）。`adoptedSkill` / `adoptedAgent` 不变 |
| `getBusinessKnowledge()`（`src/api.ts`），返回 `SourcePluginAsset[]` | `getTalentsKnowledge(projectId)` 返回 `{ talentsOrigin, artifacts: PublishedArtifact[] }`；`getTalentsFile(artifact, path)` 读取原文 |
| 协作 CLI 上下文中的 `knowledge.assets`（原为 Talent 知识资产） | 改为 `PublishedArtifact[]`。冻结后只包含与 `context.knowledgeVersion` 同版本的产物，`status` 取值不变 |
| `talentLink(page, context?)` | 签名不变，指向独立的 Talents（`/talents?role=owner\|member#/<页面>?project=…`）。`knowledge` 按角色跳到审阅页或开发者知识页；`sessions` / `evolution` 跳到知识任务 |
| `systemRuntime().app === 'talent'`、`data.talent`、`Presentation.talent` | 删除，Teams 只有一种运行模式 |
| `business-knowledge` 来源插件、`talent` 企业连接、`SourceAssetKind` 的 `'knowledge'` | 删除。Talents 产物只在「项目知识」中展示。旧状态文件里残留的 `talent` 连接不影响运行 |
| `npm run start:teams` / `launch:teams` / `stop:teams` | 仍可用，等同于 `npm start` / `launch` / `stop`。`*:talent` 和 `test:talent:services` 已删除，同时启动两边改用仓库根目录的 `npm run dev` |
| 本机配置项 `DEMO_TALENT_STATE_DIR` | 仍被接受，但不再使用。新增 `DEMO_SHARED_DIR`（共享目录，默认 `shared/data`）和 `DEMO_SHARED_SEED_DIR`（默认 `shared/seed`） |
| Talent 的 `GET /api/task-inputs`（独立需求的知识与 Skill） | 删除。Teams 用 `sharedTaskInputs(state, projectId, taskId)` 自行组装：本需求内容（`origin: 'teams-task'`）+ Talents 已发布的项目知识（`origin: 'talents-shared'`，未发布时为空）+ 已登记 Skill 正文。`knowledge.status` 恒为 `ready`；Skill 的 `availability` 由 `talent-registered-asset` 改为 `teams-registered-package` |
| Talent 的 `POST /api/task-inputs/register`（Owner 登记需求） | 删除，不再需要登记：任务输入总会包含本需求内容 |
| Talent 的 `POST /api/task-sessions`（验收后上报会话） | 删除。`exportTaskSessions()` 写入 `shared/data/teams/task-sessions/<幂等键哈希>.json`，回执 `id` 以 `SHARED-` 开头；重复上报返回同一回执。上报成功后这些会话也会出现在 `snapshot.json` 的 `sessions` 中。Talents 读取它们尚未实现 |
| 测试中启动 `server/talent.ts`，或点击知识整合按钮 | 不再启动 Talent。参考 `teams/tests/workflow-http.ts` 的 `publishFromTalents()`：向临时共享目录写入 `knowledge.json`，同时把 `DEMO_SHARED_SEED_DIR` 指向空目录，避免读到仓库里的初始数据。要模拟会话上报失败，在 `<共享目录>/teams/task-sessions` 位置放一个普通文件（见 `tests/delivery-requirements-http.ts`） |

## 四、数据变化

- 「信用卡营销交付」的 ADR-009、ADR-007 两条设计文档记录，改为指向 `workspace/carddemo-java-1025/docs/design/adr/` 下的真实 ADR。`teams/docs/cashback-integration.md` 和 `security-scope.md` 保留，但不再被引用。
- 新增 `teams/fixtures/team-sessions.json`：成员已共享的会话，会导出给 Talents 做轨迹诊断。交付会话 `WORK-PLATINUM-001` 在成员上报后才出现。

## 五、验证

```sh
cd teams && npm run typecheck && npm test && npm run test:http
```
