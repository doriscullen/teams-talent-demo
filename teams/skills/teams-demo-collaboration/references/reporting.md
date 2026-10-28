# 进展与成果字段

所有写入包含当前完整 scope、runId、真实 sessionId、该节点 adoptionId、expectedRevision。命令为 `progress add` 或 `result submit`，都使用稳定 `--operation-id` 和 UTF-8 `--input-file`。

`progress add`：phase 为 started / progress / blocked；summary 写实际进展；阻塞时必须有 blocker；evidence 是引用数组，可为空。解除阻塞时回传 progress 并说明依据，不按计时高频刷状态。

已完成节点不接受普通 started / progress / blocked / result 将其重开或覆盖。明确返工时先读 context.rework.allowed，重新读取并采用本节点输入，再用 phase=started、reopen=true 开始新一轮：需求澄清仅在开发尚未采用输入前；功能开发仅在验证待开始或阻塞时；阻塞的测试验证可以显式重开并提交本轮新检查。上一轮产物与事件保留为历史，不计入新一轮交付物。Owner 页面已退回的开发节点已重开，按普通进度继续即可。reopen 不是节点切换，进入开发用 nodeId=develop、测试用 nodeId=verify。

提交验收后，所有 CLI 写入均禁止，即使 --role owner 也不能验收、退回或重开。需要返工由 Owner 在页面手工退回；再次开发提交后重新获取验证输入、重新采用并提交新检查。模型最终停在待 Owner 验收，不能调用页面 API 绕过 CLI 限制。

开始回执必须先于实际业务编辑和测试：读当前依据 → `inputs adopt` 成功 → 用返回的新 revision 写 `progress add` / started 成功 → 开始业务工作。CLI 的 scope/context/request/receipt 临时文件不属于业务产物，可先写；PRD、设计、源代码与测试不是临时请求文件。新 run/节点重新取当前身份和采用依据，不能用旧成功回执掩盖本轮未采用；失败或超时按幂等规则核对，不能在工作结束后补一条 started 伪造时序。

`result submit`：summary、evidence（至少一条）、completedCriteria。artifact 与 completedCriteria ID 从当前 `context.nodeContract` 读取，不凭记忆套别的节点合同。

`artifact` 只标本次实际交付物，同一提交中每种 artifact 仅一条（多个文件用一份交付清单引用）。原始需求、试验口径和其它输入依据可作为普通 evidence，但不填 artifact；例如原始需求不能再标为 `prd`，避免覆盖本次编写的 PRD。

```json
{
  "kind": "reference",
  "value": "实际文件、PR或报告引用",
  "description": "引用说明",
  "artifact": "来自nodeContract",
  "version": "实际产物版本",
  "codeVersion": "相关代码PR或提交版本",
  "source": "actual"
}
```

kind 可为 reference / local-file。本机路径只是一条引用，未自动上传；远端声明也不等于 provider 已核验。PRD、设计、代码等实际交付物不得声明成 preset。设计、代码、单测和验证报告保持同一 codeVersion；上游产物 ID 与版本原样引用，不复制成另一份依据。

## 开发完成前的测试判定

先由本次变更和节点标准确定必要测试范围，不机械要求全仓全量。跨前后端的改动分别覆盖必要范围；前端通过不能代替后端测试。测试文件已编写、报告已生成、编译成功、`-DskipTests`、命令退出 0 但运行 0 用例、必要用例被 skipped，都不能声明该范围通过。

必要测试失败或未执行时，保留真实结果引用在 `progress add`，phase=blocked：说明已完成部分、未执行/失败范围、原因与解除条件。不全勾 completedCriteria，不用 `result submit` 把开发标完成，也不把“剩余限制已说明”当豁免。缺 JDK/Maven、依赖、权限等都是阻塞；环境就绪或 compile 成功只是解除条件的一部分，仍须实际运行必要测试。

测试报告列明当前 codeVersion、必要范围、实际命令、通过/失败/跳过/未执行数量或范围、退出码、真实日志/结果路径。保留实际输出；不补造执行、用例数或通过结论。修复后按受影响范围重跑并更新同版本证据，旧失败记录不删除。开发单测只接受实际执行；验证阶段允许的预置质量检查不能借给开发单测充数。

开发结果的 `artifact="unit-test-result"` evidence 必须为 `source="actual"`，并携带 `execution`：

```text
kind: "unit-tests"
codeVersion: 与本次代码 evidence 相同的版本
requiredScopes: 本次改动必须测试的范围名称数组
runs: [{scope, command, status: "passed" | "failed" | "not-run",
        exitCode: 整数 | null, passed: 整数, failed: 整数, skipped: 整数,
        executedAt: 实际执行的 ISO 时间（已执行时必填）,
        excludedSkips?: {count: 非必要跳过数, reason: 排除理由}}]
notRunScopes: 尚未运行的必要范围名称数组
```

完成声明要求每个 requiredScope 都有实际通过的 run：exitCode=0、passed>0、failed=0，且没有必要用例跳过；所有 runs 都为 passed，notRunScopes 为空。skipped 默认都算未执行；只有明确不属于本次必要范围的跳过，才可用 excludedSkips 逐 run 声明数量和具体影响范围/理由（count≤skipped），使 skipped−excludedSkips.count=0。不能排除 requiredScopes 内的必要用例或用此字段掩盖未运行。execution、测试报告和代码 evidence 的 codeVersion 一致。新节点合同含 `develop.tests` 标准；提交时仍从当前 nodeContract 取得标准 ID。未完成声明可随 blocked progress 的 evidence 保存，不得把 not-run 改成 passed 或删除未测范围。服务端只核对声明结构和一致性，不会替你运行测试，也不能证明报告真实。

## 验证检查

验证结果同时提供 checks：每项 `{artifact,status,source,summary}`。artifact 与本次报告对应，status 为 passed / failed，source 为 actual / preset 且与对应 evidence 一致。可预置检查必须标明其范围，不称真实命令或远端扫描。失败可提交为未完成记录，但不能声明“本轮通过”标准；通过必须满足当前 nodeContract 的全部必需报告、标准及同一代码版本。Owner 退回/重新开发后需本轮新检查，不能重用旧通过结论。

测试用例定义来自企业测试资产插件的节点输入，保留用例 ID、版本和预期；Talents 知识与质量 Skill 不替代用例或执行报告。数据收集不在这里手动触发，CLI 也不能替代 Owner 验收。

## 提交与 PR 边界

仅在开发者已明确开始 develop、当前需求实现完成且必要范围单测实际通过时执行。CLI 显式工作指令与 TUI 内开发者指令遵循同一节点门禁；初始化的只读轮结束不等于 PRD 已确认，也不授权跳过 prepare.confirmed。

先核对启动材料中的工作树、当前任务分支、origin 和允许的 CardDemo 子目录。必须与本任务绑定一致；分支不能是 main、master 或 develop。复用本任务已有分支/PR，PR base 固定 develop。没有已核验任务绑定、真实 remote/权限不可用、工作区混合改动无法区分时，以 progress blocked 回报，不创建替代 PR 或假链接。

查看 Git 工作区和暂存区差异，只暂存本需求允许路径/变更块；禁止 git add .，禁止收录暂存区原有无关改动、其他任务、Teams/Talents 工程、历史会话或全局配置。提交前复核完整 staged diff 和必要测试所对应的代码版本；如果无法安全隔离，停下说明阻塞，不替别人还原文件。

推送本任务分支并创建或更新 PR，回传真实 PR URL、完整 commit SHA/codeVersion 和同版本测试证据。不得直接推 main/master/develop、合并 PR 或部署。PR 创建成功也不等于 Owner 验收通过。仅打开 TUI、初始化/prepare 阶段不自动提交；已有运行会话的旧指令不因 Teams 文件更新而自动改变。
