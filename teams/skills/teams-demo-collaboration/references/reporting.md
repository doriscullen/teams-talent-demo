# 进展与成果字段

所有写入包含当前完整 scope、runId、真实 sessionId、该节点 adoptionId、expectedRevision。命令为 `progress add` 或 `result submit`，都使用稳定 `--operation-id` 和 UTF-8 `--input-file`。

`progress add`：phase 为 started / progress / blocked；summary 写实际进展；阻塞时必须有 blocker；evidence 是引用数组，可为空。解除阻塞时回传 progress 并说明依据，不按计时高频刷状态。

`result submit`：summary、evidence（至少一条）、completedCriteria。artifact 与 completedCriteria ID 从当前 `context.nodeContract` 读取，不凭记忆套别的节点合同。

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
