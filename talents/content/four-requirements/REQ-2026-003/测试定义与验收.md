# REQ-2026-003 · 企业测试用例定义与验收

来源：原始需求 §9 场景矩阵与 §10 验收标准。版本 REQ-2026-003-cases-v1。以下均为待执行用例，不是已运行报告；存在冲突的期望必须关联PRD决策，禁止直接标通过。测试资产插件提供用例，Talent提供验证知识与Skill。

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | 额度 8000 申请 12000，初审与终审通过 | 持卡人 + 初审 + 审批人 | POST `/limit-applications` → `/review` → `/approve` | 状态由 `SUBMITTED` 到 `APPROVED`，account 额度 5 秒内变为 12000，通知已发 |
| 主流程 | 初审拒绝并填写原因 | 初审 | POST `/admin/limit-applications/{id}/review` | 状态 `REJECTED`，客户进度页展示原因 |
| 边界 | 申请额度 = 当前额度 × 2（8000→16000） | 持卡人 | POST `/limit-applications` | 不触发双人审批，`dualApprovalRequired=false` |
| 边界 | 申请额度 = 当前额度 × 2 + 0.01（8000→16000.01） | 持卡人 | POST `/limit-applications` | 触发双人审批，`dualApprovalRequired=true` |
| 边界 | 申请额度 = 产品上限 25000 | 持卡人 | POST `/limit-applications` | 预审通过，允许进入初审 |
| 异常 | 近 6 个月存在 1 个月逾期 | 持卡人 | POST `/limit-applications` | 预审置 `REJECTED`，提示逾期记录 |
| 异常 | 同一账户 7 天内第 2 次提交 | 持卡人 | POST `/limit-applications` | 409 `LIMIT_APPLICATION_EXISTS` |
| 异常 | 初审人与终审人为同一账号 | 审批人 | POST `/admin/limit-applications/{id}/approve` | 403 `SOD_VIOLATION` |
| 异常 | 审批后 account-service 不可用 | 审批人 | 停用 account-service 后 POST `/approve` | 状态 `APPROVED_PENDING`，恢复后自动生效，无重复审批 |
| 异常 | 上传 6MB PDF 作为收入材料 | 持卡人 | POST `/limit-applications/{id}/documents` | 400 `INVALID_DOCUMENT` |
| 权限 | 客户 A 查询客户 B 的申请 | 持卡人 | GET `/limit-applications/{id}` | 404，无数据泄露 |
| 权限 | 风控合规账号尝试审批 | 风控/合规 | POST `/admin/limit-applications/{id}/approve` | 403，缺少 `limit:approve` |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 当前额度 8000、产品上限 25000、无逾期、开卡 24 个月 | 申请 12000 并由初审与终审通过 | 状态 `APPROVED`，account 额度 12000，客户收到通知 | 账户 00000000006 |
| US-002 | 近 6 个月存在 1 个月逾期 | 提交申请 12000 | 预审 `REJECTED`，展示「近 6 个月存在逾期记录」 | 账单逾期数据 1 条 |
| US-003 | 已存在进行中申请 | 再次提交申请 | 409 `LIMIT_APPLICATION_EXISTS`，申请表仅 1 条 | 复用 US-001 数据 |
| US-004 | 初审人与终审人为同一账号 | 执行终审 | 403 `SOD_VIOLATION`，申请状态不变 | 单账号双角色配置 |
| US-005 | 申请 8000→16000.01 | 提交并进入审批 | `dualApprovalRequired=true`，缺第二审批人时返回 `DUAL_APPROVAL_REQUIRED` | US-001 账户 + 材料 |
| US-006 | 审批通过后 account-service 停用 | 执行终审 | 状态 `APPROVED_PENDING`；恢复服务后自动生效且仅 1 次额度更新 | 停用与恢复容器 |
| US-007 | 申请被拒绝 | 打开客户进度页 | 展示拒绝原因与客服入口，拒绝原因为空时提交被拦截 | US-002 数据 |
| US-008 | 开卡 2 个月的账户 | 提交提额申请 | 预审拒绝，提示「开卡满 3 个月后可申请提额」 | 新开户 00000000007 |

## 执行证据要求

功能测试、静态工具检查、Agent Review、安全报告和问题复测分别记录实际命令/工具版本/代码commit/退出码/报告路径。Owner验收依据为这些实际结果；知识发布不表示已验收。
