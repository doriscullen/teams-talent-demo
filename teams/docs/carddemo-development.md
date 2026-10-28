# CardDemo 初始化与交付检查

本指南适用于 Credit Card 项目的实际代码开发。Teams/Talents 平台继续在 `main` 运行；CardDemo 使用单独的 `develop` 工作区和需求分支。先核对工具，再初始化目录，最后从绑定的任务目录执行开发与测试。

## 启动前核对

| 用途 | 要求与检查 |
|---|---|
| 平台和工作区工具 | Node.js 24、npm、Git；运行 `node --version`、`npm --version`、`git --version` |
| CardDemo Java 构建与测试 | **JDK 21**、Maven 3.9+；运行 `java -version` 和 `mvn -version`，两处都应显示 Java 21 |
| 原生作业 | 本机 iCode 和已配置的 Agent/模型；检查 `icode --version`，再以 Teams「引擎定位」及作业计划解析的实际入口为准 |
| GitHub 提交／PR | Git 提交身份、目标仓库访问权限、已登录的 GitHub CLI；检查 `git var GIT_AUTHOR_IDENT`、`gh --version`、`gh auth status --hostname github.com`，不要输出或复制 token |
| 轨迹页 | Python 3.10+ 与 trace-server 依赖；iCode 自身的 trace exporter 另按[快速启动](quick-start.md#icode-tui-与-trace)检查 |
| 跨服务冒烟 | Docker/Compose、Bash、curl、Python 3；`docker compose version` 和 `docker info` 只核验引擎，业务服务还需启动和健康检查 |
| 静态检查与依赖／密钥扫描 | Maven PMD 插件 3.26.0、Trivy；`trivy --version`。PMD 由下文的固定 Maven 坐标获取，Trivy 需另行安装；本流程已使用 Trivy 0.76.1 |

父 POM 的 `java.version` 和 `maven.compiler.release` 均为 21。已有测试曾在 JDK 27 下因 Mockito/Byte Buddy 不支持该 Java 版本而失败；使用 JDK 21，不用跳过测试或实验兼容开关掩盖失败。设置环境后再启动 Teams，使原生作业继承同一工具链。

macOS 当前终端选择已安装的 JDK 21：

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
command -v java mvn node git icode
java -version
mvn -version
```

Windows PowerShell 使用实际安装目录替换下例路径：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Get-Command java,mvn,node,git,icode
java -version
mvn -version
```

`JAVA_HOME` 应指向 JDK 根目录。PATH 上的 iCode 与 Teams 的 `DEMO_ICODE_BINARY` 可以不同；核验实际作业版本，保留现有用户模型配置。网页运行无需 JDK 或 iCode，实际 CardDemo Java 开发和原生作业分别需要这些工具。

Teams 新启动的 iCode CLI／TUI 子进程会合并已有 `NO_PROXY` 和 `no_proxy`，补入 `127.0.0.1`、`localhost`、`::1`（以及部分客户端需要的 `[::1]`），避免本机 API、轨迹和独立测试请求走外网代理。其他代理配置保持原值，不改系统环境；已运行会话不会被追改。在 Teams 外手动运行测试时，也应在当前终端为本机地址配置代理排除，并保留原有排除项。

缺少工具时，先安装 JDK 21、Apache Maven、Docker Desktop（启用 Linux 容器）、Git/GitHub CLI 和 Trivy，再核对实际版本。macOS 可用包管理器或官方安装包，Windows 可用官方安装包或已批准的包管理器；不要把另一台机器的绝对路径复制为配置。Maven 首次需要下载插件与依赖，Trivy 首次需要获取漏洞库；下载失败须保留错误并解决，不能改用空报告。仅在项目 POM 明确需要时增加其他服务，本基线无需 Redis。

## 初始化业务基线与需求目录

以下命令均在平台仓库根目录执行。先由维护者明确获取并选定 `origin/main` 或 `origin/develop` 的提交，将输出的完整 40 位 SHA 填入命令。工具不自动 fetch、安装依赖或推送。

```sh
git remote get-url origin
git fetch origin
git rev-parse origin/main
git rev-parse origin/develop
npm run carddemo:workspace -- init --base-commit <40位SHA>
npm run carddemo:workspace -- init --base-commit <同一40位SHA> --apply
```

首次尚无 `origin/develop` 时，该引用查询会报不存在；由维护者明确选择已获取的 `origin/main`。已有 `origin/develop` 时，初始 SHA 必须与它一致。基线用完整提交 SHA 记录，不以需求包中的环境名称猜测代码版本。

默认只输出预览。核对来源仓库、基线、分支和目录后才加 `--apply`。可用 `--expected-origin` 固定预期远端，`--worktree` 指定绝对同级目录；已有分支和目录必须通过工具核验。`fetch` 只更新远端引用，不在平台目录执行 `pull`、切换分支、stash、reset 或覆盖未提交文件。

需求 PR 需要远端 `develop` 已存在。首次初始化后，由维护者核对 `git rev-parse develop` 与选定基线 SHA，再显式发布该分支：

```sh
git rev-parse develop
git push -u origin develop
git ls-remote --heads origin develop
```

这一步只发布已核对的 Git 提交，未提交文件不会被带入。工具本身不 push；已有远端分支时先核对其历史，不强制覆盖。GitHub 登录成功还需具备目标仓库推送和创建 PR 的权限。任务中明确授权提交／推送／PR 后，iCode 才可使用 `git`／`gh`，PR 的 base 固定为 `develop`；本机预览与启动检查不创建 PR。

初始化启用后，新创建的任务会在后台准备真实会话前建立独立任务 worktree；只读查询不会创建目录。启用前已存在且尚未执行的任务，或需要先核对任务目录时，使用显式入口：

```sh
npm run carddemo:workspace -- task init --project carddemo --task <完整任务ID>
npm run carddemo:workspace -- task init --project carddemo --task <完整任务ID> --apply
```

页面的 `MKT-001` 对应内部 ID `DEMO-MKT-001`；新需求使用完整 `REQ-…`。目录以工具输出为准：任务 worktree 使用 `codex/carddemo-…` 分支，实际业务代码位于其 `workspace/carddemo-java-1025`。开发只修改该业务目录，需求 PR 的目标是 `develop`；平台修改继续走 `main`。初始化不会创建 PR、提交或推送。

本机配置保存在忽略文件 `teams/.local/carddemo-workspace.json`，任务目录绑定保存在实际 Teams 状态目录的 `project-task-directory-bindings.json`。`init` 输出的 `directory` 是 develop 业务目录，`task init` 的 `binding.directory` 是任务业务目录。每条新绑定取**创建绑定时已配置 develop worktree 的 HEAD**，并固定 `baseCommit`；以后 develop 前进不改变已有任务基线。绑定供新作业解析使用；已运行或已准备会话仍保留原目录，工具拒绝迁移这类任务。原目录未提交代码原样保留，新基线和任务 worktree 只取已选定的 Git 提交，不带入这些改动、密钥或本机配置。

## 页面 TUI 与显式 CLI 作业

先在 Teams 分配需求，等待当前节点知识获取完成，并按页面提示确认准备会话。真实会话准备完成后，交付人可以从「iCode 作业」进入同一会话的 TUI，输入本次节点的工作指令；已有活动窗口按计划进入，不重复新建。查看他人任务不会取得执行权限。

需要通过命令明确下发工作时，在平台仓库的 `teams/` 目录使用以下入口。先把 `<任务ID>`、`<UUID>` 和指令文件路径替换为实际值；`--role` 必须与该需求交付人一致，节点内部 ID 为 `prepare`、`develop`、`verify`。

```sh
npm run work:icode -- plan --endpoint http://127.0.0.1:45970 --role member --project carddemo --task <任务ID> --node prepare --mode cli
npm run work:icode -- start --endpoint http://127.0.0.1:45970 --role member --project carddemo --task <任务ID> --node prepare --mode cli --request-id <UUID> --instruction-file "/absolute/path/prepare.txt"
npm run work:icode -- status --endpoint http://127.0.0.1:45970 --role member --project carddemo --task <任务ID> --node prepare --request-id <同一UUID>
```

指令文件使用 UTF-8，明确本节点目标、允许修改的业务目录、测试与停止条件，以及是否允许提交／推送／创建 PR；也可用 `--instruction "工作指令"`，两者只能选一个。Windows 使用实际 Windows 路径。`plan` 和 `status` 只读；`start` 仅恢复已准备、未活动的本任务真实会话，未就绪时先回 Teams 完成准备。它实际调用 iCode 执行本次节点指令，不自动跨阶段。

启动回执给出 request/session、上下文及日志路径；`status` 区分 pending、running、completed、failed、unknown。退出码 0 表示请求成功，不能据此判断节点已完成；1 表示参数或请求失败，2 表示执行失败、状态未知或需要核对。保留默认 runtime 下 `work-cli-receipts` 的请求与回执，或显式指定 `--receipt-dir`。超时先用原 request ID 查询；重试保留原 ID、scope 和同一指令，不删除回执绕过冲突。

原生启动 CLI 与协作 CLI 分工不同：`work:icode` 负责启动／查询，iCode 内通过 [`teams-demo.mjs` 与协作 Skill](../skills/teams-demo-collaboration/SKILL.md) 拉取当前节点上下文、记录实际采用、回传进度和真实产物。每个业务 run 都应先实际读取当前节点所需上下文，再收到 `inputs adopt` 成功回执、`progress add` / started 成功回执，随后编辑业务文档／代码或运行测试，不能事后补开始记录。下一节点输入按阶段获取，未 ready 时等待，不提前使用全量知识；会话就绪与命令退出不代替采用、测试或人工验收。

## 测试与交付证据

以下命令在工具返回的 CardDemo 业务代码目录执行。首次核验基线建议完整运行：

```sh
mvn -version
mvn -B -ntp package
```

`package` 会执行测试并生成容器构建所需 JAR；仅测试可用 `mvn -B -ntp test`。已登记基线有 8 个 Maven 模块，使用 JUnit 5、Spring Boot Test、MockMvc、Mockito；7 个业务服务的测试数据源是 H2，迁移由 Flyway 执行，跨服务调用使用测试替身。模块和测试总数以所选提交为准，新增业务不能沿用旧基线数量作为覆盖证明。普通 Maven 测试不需要外部 PostgreSQL、Redis 或 Docker，H2 结果不能替代 PostgreSQL 跨服务验证。

返现相关改动的定点命令为：

```sh
mvn -pl services/card-service,services/marketing-service,services/transaction-service,services/web-ui -am test
```

根据实际变更补齐其他受影响模块。必要范围必须全部执行通过；测试失败、跳过、未运行时保持开发阻塞，不提交“开发完成”。`scripts/build-and-up.sh` 使用 `-DskipTests package`，启动成功不提供测试通过证据。

| 检查 | 当前工具与边界 | 证据 |
|---|---|---|
| Java 单元／服务内接口 | 上述 Maven 测试；H2/Flyway、MockMvc/Mockito | 各模块 `target/surefire-reports/` 的 XML/text、完整命令和退出码 |
| 跨服务功能集成 | `docker-compose.yml` 的 PostgreSQL 16 和服务；`scripts/smoke-test.sh` 使用 curl/Python | 健康检查、HTTP 断言与日志；脚本会登录、入账和授权，只在独立测试数据环境执行 |
| 前端逻辑／功能 | 以当前需求分支实际存在的测试为准；Maven 不自动执行 Node 测试 | 单独的 Node／浏览器结果。旧目录的未提交测试不会自动进入新基线 |
| 代码静态检查 | Maven PMD 3.26.0；编译和 `git diff --check` 另行核对 | 各模块 PMD XML/HTML、规则、优先级、命令与退出码；与 Agent Review 分开 |
| Agent Review | iCode 按代码版本和 `dev-code-reviewer` 等实际选用 Skill 进行审阅 | 模型／Agent、代码版本、问题位置与结论；与静态工具报告分开 |
| 安全扫描 | Trivy 文件系统依赖／密钥扫描；安全 Skill 提供审查规范 | 工具和漏洞库版本、POM/JAR 范围、原始 JSON 与逐项结论；不等于容器 OS 扫描或渗透测试 |
| 修复与复验 | 针对失败问题修改后重跑原失败检查及必要回归 | 问题 ID、修复版本、前后报告和退出码，保留失败记录 |

### 独立 PostgreSQL／跨服务环境

默认 `docker-compose.yml` 有固定容器名、端口和数据库卷；**仅增加 `-p` 不足以隔离这些固定值**。每个需求使用自己的 Compose 配置和数据库，先从该任务业务目录生成可审阅配置：

```sh
docker compose --project-directory "<任务业务目录>" -p "carddemo-e2e-<任务短标识>" -f "<任务业务目录>/docker-compose.yml" config --format json --output "<忽略的任务证据目录>/compose.json"
```

生成前在本终端设置专用 `IAM_TOKEN_SECRET`，避免沿用默认示例密钥。配置文件包含展开后的环境信息，仅保存在本机忽略目录，不提交或公开。在启动前检查并调整该文件：移除固定 `container_name`；宿主端口绑定 `127.0.0.1` 并使用空闲端口（`published: "0"` 可由 Docker 分配）；卷和网络名称带唯一任务前缀且非 external；构建目录、只读初始化 SQL 绑定都属于当前任务 worktree；不启用 host network 或 privileged。批次已有独立配置时复用它，不另起一套或接入别人数据库。

```sh
docker compose -f "<任务证据目录>/compose.json" config --quiet
docker compose -f "<任务证据目录>/compose.json" up -d --build --wait --wait-timeout 180
docker compose -f "<任务证据目录>/compose.json" ps
docker compose -f "<任务证据目录>/compose.json" port iam-service 8081
docker compose -f "<任务证据目录>/compose.json" port web-ui 8080
```

先构建 JAR，再构建容器。`--wait` 不替代 HTTP 验证：逐服务检查 `/actuator/health`，业务服务另检查 `/v3/api-docs`，并验证 Web 入口与本需求接口。动态宿主端口在重启后可能改变，每次重新读取映射；内部服务间地址继续使用 Compose 服务名。

现有 `scripts/smoke-test.sh` 接受 `IAM`、`CUSTOMER`、`CARD`、`ACCOUNT`、`TRANSACTION`、`AUTHORIZATION`、`MARKETING` 七个完整 HTTP origin 环境变量。将它们全部设为该独立环境的实际端口后，从任务业务目录运行 `bash scripts/smoke-test.sh`；不要遗漏后回落默认端口。脚本会登录、入账和授权，日志中的 token 应脱敏。它只覆盖基线冒烟；新增需求还需实际权限拒绝、幂等／并发、错误边界、重启持久性，以及需求约定的性能和审计检查。Windows 可在 Git Bash 中运行 Bash 脚本；macOS 实测不代表 Windows GUI 或 Docker 已实测。

### PMD 与 Trivy

在已固定代码版本的任务业务目录执行，报告输出到该任务的忽略证据目录：

```sh
git diff --check
mvn -B -ntp org.apache.maven.plugins:maven-pmd-plugin:3.26.0:pmd
trivy --version
trivy fs --scanners vuln,secret --format json --output "<任务证据目录>/trivy.json" .
```

PMD 的 `pmd` 是生成报告的 goal，成功退出不表示零问题；检查各模块 `target/pmd.xml`／`target/site/pmd.html`。Trivy 默认成功退出也不表示无漏洞，检查 JSON 中的漏洞与密钥结果，保留实际版本、扫描时间和数据库信息。先 `package` 再扫，使构建 JAR 及其中运行依赖进入核查范围；同一依赖在多个服务出现时可汇总，但不删除原始结果。

把当前任务新增风险、基线已有风险和未覆盖范围分开。依赖告警即使当前应用未具备触发条件，也保留其原始严重级别并给出源码／配置依据；新需求可能改变适用性，必须重核。不要凭 Skill、模型总结、无 findings 的退出码或忽略规则宣称“安全通过”。这里的手动工具不等于 GitHub 已配置 Java CI；PR 无 check 时需明确列出实际本地验证。

已有本地前端功能测试可能依赖仓库外的 jsdom 路径；这类脚本须先在需求分支中登记可复现依赖和执行方式，不能作为新基线已具备的通用测试。不要为消除缺工具错误自动下载或静默跳过。

每项报告至少保留：任务与节点、代码 commit／未提交 diff 摘要、工具和版本、完整命令、执行时间、退出码、通过／失败／跳过数量、日志和问题引用。原始 Maven 报告保留在各模块 `target/`。PRD、设计、业务代码和测试应提交到任务分支；PR head 固定后生成的运行报告可放在独立忽略证据目录，正文写明被测 SHA，避免为提交含 SHA 的报告本身不断改变版本。Teams 成果回传引用真实文件和同一代码版本。`preset` 只用于明确允许的验证流程检查，不能充当真实开发单测、真实扫描或真实模型执行证据。

## PR 验收与 develop 更新

开发者已明确授权提交时，iCode 可在本任务绑定的 `codex/carddemo-…` 分支提交、推送并创建 base 为 `develop` 的 PR；不能直接推平台 `main` 或业务 `develop`，不能替 Owner 合并。只暂存本需求的明确文件／变更块，不用 `git add .` 带入已有脏文件。PRD、设计与代码提交、单测报告、验证报告必须对应当前 PR head；后续修复改变 SHA 后重新验证，不借旧报告通过。

Owner 先检查需求范围、PR diff、真实原生工具／CLI 回执、必要测试和静态／安全报告，再在 Teams 明确验收或退回。通过后核对任务会话归集共享回执。维护者在获得合并授权后执行：

```sh
gh pr view <PR号或URL> --json baseRefName,headRefName,headRefOid,state
gh pr diff <PR号或URL>
gh pr checks <PR号或URL>
gh pr merge <PR号或URL> --merge
```

无自动检查不等于检查通过。合并后，在**已登记的独立 develop worktree** 中确认工作区干净，再快进；不要在平台 main 或任务工作树里执行这组更新：

```sh
git -C "<develop worktree根>" status --short
git -C "<develop worktree根>" fetch origin develop
git -C "<develop worktree根>" merge --ff-only origin/develop
git -C "<develop worktree根>" rev-parse HEAD
```

若不干净或不能快进，先定位冲突，不 reset、不强推、不复制旧 checkout 的脏业务代码。下一需求新绑定将以更新后的 develop HEAD 为基线，已有需求绑定和会话不迁移。

## 回退代码与清理环境

代码回退与环境清理分别处理，先保存验收证据并确认相关原生任务已结束：

| 目的 | 操作 | 不会改变 |
|---|---|---|
| 撤回已合并试验业务代码 | 从最新 `origin/develop` 新建回退 worktree／分支，用 `git revert` 后提 PR 到 develop | 平台 main、原 checkout 脏改动、历史会话和 Teams 验收记录 |
| 释放本次测试资源 | 使用本需求准确 Compose 文件 `down -v` | 其他 Compose 项目和业务 Git 内容 |

用户已批准的试验合并需要还原时，维护者可从已核对的最新 develop 创建专用回退分支。对 merge commit 使用 `-m 1`，按合并的逆序逐一 revert；若原 PR 是 squash／普通提交则不用 `-m`，先核对提交父节点。示例只表示一个已确认 merge commit：

```sh
git fetch origin develop
git worktree add -b codex/carddemo-revert-batch "<新的回退worktree绝对路径>" origin/develop
git -C "<回退worktree根>" show --no-patch --format="%H %P" <待撤回mergeSHA>
git -C "<回退worktree根>" revert -m 1 <待撤回mergeSHA>
```

在回退工作树运行受影响测试，核对只撤回本批业务变更，再推该分支、创建 base=develop 的回退 PR，经审查合入并快进 develop。不要用 `reset --hard`、强推或手工覆盖代码抹掉历史；后续任务已依赖这些改动时，先评估逆序回退影响。

独立运行环境仅在无人使用后清理：

```sh
docker compose -f "<该任务的准确compose.json>" down -v
```

`-v` 会删除该环境数据库卷；先核对 Compose project 与容器标签，不执行全局 prune，也不使用别人的配置文件。任何步骤遇到未知活动会话、身份／版本冲突或损坏材料时停止并报告，不降级成整库清空。
