# CLI 请求与读取

CLI 是启动材料给出的 `scripts/teams-demo.mjs`，不是另一个 `teams` 命令。使用真实绝对路径和本机 endpoint，不照抄下面的占位符。

```sh
node CLI --endpoint ORIGIN --role member context get --input-file SCOPE.json --output CONTEXT.json
node CLI --endpoint ORIGIN --role member inputs adopt --operation-id OP --input-file REQUEST.json
node CLI --endpoint ORIGIN --role member operation get --operation-id OP
```

保留入口给出的 `--role owner` 或 `--role member`。读取 scope 包含 projectId、taskId、nodeId，以及入口提供的 tab；也可用 `--project / --task / --node / --tab` 分字段读取，不能与 input 中的同字段重复。项目级无 task/node 的上下文只能读取，不能写任务进度。

`context get` 默认 `--view model`：业务正文与约定完整，重复正文变为引用。`--view full` 仅在排查完整服务响应时使用。`--output` 原子保存所选投影，stdout 返回 outputPath、scope、revision、basisDigest、资源数量；读取该文件才能查看正文。没有 `--output` 时 stdout 返回所选上下文。

采用请求字段：

```json
{
  "projectId": "FROM_CONTEXT", "taskId": "FROM_CONTEXT", "nodeId": "FROM_CONTEXT",
  "tab": "FROM_CONTEXT_IF_PRESENT", "runId": "FROM_LAUNCH", "sessionId": "FROM_NATIVE_OBSERVER",
  "expectedRevision": 0, "basisDigest": "FROM_CURRENT_CONTEXT", "readReferences": []
}
```

expectedRevision 取当前读取/上次成功回执，不照抄 0。readReferences 只列实际阅读的合法引用 ID，可如实为空。返回 adoptionId 供同节点后续写入使用；改变 run/session 身份时重新采用，旧记录仍保留。

CLI 在发送写请求前落盘完整 request，成功后保存 receipt；默认位置由当前服务配置决定，`--receipt-dir DIR` 可指定。失败退出非零并明确错误，不自动重发。操作未知时先核对原 operationId；同一 ID 不同载荷会被拒绝。`--output` 不改变写命令的回执语义。

## Windows PowerShell

复制启动材料中的 `& 'Node路径' 'CLI路径' ... --input-file '文件路径'` 形式。JSON 文件用 UTF-8；不要在 PowerShell 5.1 用 `--input` 内联 JSON，原生参数绑定可能剥掉双引号。输出可写 `--output "$env:TEMP/teams-context.json"`。scope 改节点时创建新的请求文件，不改已存的启动材料或历史采用文件。
