---
name: teams-demo-collaboration
description: 在 Teams 已提供项目、任务、节点和原生会话入口时，读取当前节点依据、明确采用，并用本机 CLI 回传真实进展、阻塞与成果。适用于交付人开始或继续该任务，不代替 Owner 验收。
---

# Teams 协作

使用启动材料中的 CLI 绝对路径、endpoint、`--role`、projectId、taskId、nodeId、runId。读取原生观察器提供的 `native-session.json`，核对范围并使用真实 sessionId；尚未取得时等待或报告，不能借用其他任务身份。Owner 也可作为交付人，但只有当前被分配的人能写入。

## 读取与采用

首次开展业务工作时，执行启动材料中的 `context get --input-file SCOPE.json --output CONTEXT.json` 并读取保存的内容。CLI 默认返回去重后的模型上下文；有 `--output` 时 stdout 只是保存回执，不是正文。命令写法、参数与 PowerShell 注意事项见 [CLI 参数](references/cli.md)，需要构造请求时再读。

以 `nodeContract` 为本节点输入、交付物、完成标准的唯一依据；正文在顶层 `knowledge.assets` 与 `skills`，其他位置按 ID 引用。只读取当前工作所需材料，不扩展到全部项目 Skill。缺失、未配置或本节点知识未就绪时停在等待/阻塞，不拿其他节点或新版本补成已就绪。`historical-subset` 仅是历史采用子集。

对已实际读过且版本未变的材料直接复用，不每轮全文重读。开发者明确切换节点、输入版本变化或服务报告依据冲突时，再获取该节点的上下文；保持项目、任务、角色、run/session 身份，不复用初始 scope 的旧 nodeId。

实际阅读后通过 `inputs adopt` 保存依据：使用刚读取的 revision、basisDigest、完整 scope（含返回的 tab）和真实 readReferences，保留 adoptionId。读取、Hook 提醒、会话就绪均不等于已阅读或采用；采用也不等于节点完成。每个节点独立采用，不能跨节点复用 adoptionId。

## 回传与交接

开始实际工作及有意义的里程碑用 `progress add`；阻塞写明原因，解决后回传解除依据。完成后按当前 `nodeContract` 用 `result submit` 提交产物引用、版本和已满足的标准 ID。构造成果或检查结果时读 [回传字段](references/reporting.md)。只报告实际发生的工作；验证阶段按节点合同允许的预置检查标 `preset`，真实执行标 `actual`；开发单测不能预置。

完成开发前，必须按变更影响确定必要测试范围并实际执行通过；写了测试/报告、仅编译或部分套件通过都不够。必要测试失败、跳过或未运行时用 `progress add` 报阻塞，不提交开发完成，也不以“已说明剩余限制”豁免；细则见 [回传字段](references/reporting.md)。

上游成果按合同通过后，下一节点知识会自动获取；等待该节点输入 ready 才采用和执行。会话可继续使用，但不自动连续执行全部节点。影响开发的未确认事项不能自行确认；节点成果只是交付人声明，不等于远端证据已核验。

每个逻辑写操作用稳定 operationId，保留 CLI 保存的请求与回执。超时/响应丢失先 `operation get` 核对；重试保持原 ID 和完整载荷。revision/依据冲突先重读并协调，不换 ID 绕过冲突，不直接改状态文件补成功。

开发/验证回传会关联同一任务的真实 session。最终停在待 Owner 人工验收，即使交付人是 Owner 也不能用 CLI 代验收。验收后的归集/上报由 Teams 触发；本地归集不代表 Talents 已接收或分析完成。
