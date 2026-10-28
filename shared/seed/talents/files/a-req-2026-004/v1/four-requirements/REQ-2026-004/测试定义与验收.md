# REQ-2026-004 · 企业测试用例定义与验收

来源：原始需求 §9 场景矩阵与 §10 验收标准。版本 REQ-2026-004-cases-v1。以下均为待执行用例，不是已运行报告；存在冲突的期望必须关联PRD决策，禁止直接标通过。测试资产插件提供用例，Talent提供验证知识与Skill。

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | 90 天内已入账交易提交 FRAUD 争议并上传 1 份 PDF | 持卡人 | POST `/disputes` + `/evidence` | 201，案件 `OPEN`，`sla_due_at` = 提交时间 + 1 个工作日，客户可见时间线 |
| 主流程 | 专员审核通过并发起临时入账 299.00 | 争议专员 | POST `/admin/disputes/{id}/review` + `/provisional-credit` | 案件 `PROVISIONAL_CREDIT`，账户贷记 299.00，客户可见入账状态 |
| 主流程 | chargeback 胜诉结案 | 争议专员 | POST `/admin/disputes/{id}/chargeback` + `/resolve`（`won=true`） | 案件 `WON` 后 `CLOSED`，保留临时入账，通知已发 |
| 边界 | 交易入账日距今天 90 天整 | 持卡人 | POST `/disputes` | 201，允许开案 |
| 边界 | 交易入账日距今天 91 天 | 持卡人 | POST `/disputes` | 409 `DISPUTE_NOT_ELIGIBLE` |
| 边界 | 临时入账金额 = 争议金额 | 争议专员 | POST `/provisional-credit`，`creditAmount` = `amount` | 200，入账成功 |
| 边界 | 单案上传第 5 份证据 | 持卡人 | POST `/disputes/{id}/evidence` | 200，证据数达到上限 |
| 异常 | 同一交易第 2 次开案 | 持卡人 | POST `/disputes` | 409 `DISPUTE_EXISTS` |
| 异常 | FRAUD 原因未上传证据 | 持卡人 | POST `/disputes` | 409 `EVIDENCE_REQUIRED` |
| 异常 | 临时入账重复提交 2 次 | 争议专员 | POST `/provisional-credit`，`provisionalCreditId` 固定 | 账户只贷记 1 次，第 2 次返回首次结果 |
| 异常 | 临时入账金额 300.00 而争议金额 299.00 | 争议专员 | POST `/provisional-credit` | 409 `PROVISIONAL_CREDIT_EXCEEDS_AMOUNT` |
| 异常 | 第 31 天发起 chargeback | 争议专员 | POST `/chargeback` | 409 `CHARGEBACK_WINDOW_EXPIRED` |
| 时限 | 案件距 SLA 到期 23 小时 | 系统扫描 | 每日 02:00 扫描任务 | 专员与主管收到提醒，`slaState=DUE_SOON` |
| 权限 | 客户 A 下载客户 B 的证据 | 持卡人 | GET 证据下载地址 | 403，无文件内容返回，审计记录拒绝 |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 90 天内已入账交易 299.00，无进行中争议 | 提交 FRAUD 争议并上传 1 份 PDF | 案件 `OPEN`，客户可查看时间线与 SLA 到期时间 | 交易 0000000000000200，账户 00000000006 |
| US-002 | 同一交易已有 `OPEN` 案件 | 再次开案 | 409 `DISPUTE_EXISTS`，案件数不变 | 复用 US-001 数据 |
| US-003 | 交易尚未上传证据 | 提交 FRAUD 争议 | 409 `EVIDENCE_REQUIRED` | 复用 US-001 数据 |
| US-004 | 案件 `UNDER_REVIEW` | 临时入账 100.00 并重复提交 | 账户贷记 100.00 一次，案件 `PROVISIONAL_CREDIT` | 案件号 + 账户余额初始值 |
| US-005 | 案件已临时入账 | 发起 chargeback 并结案 `won=true` | 状态 `WON` 后 `CLOSED`，客户收到通知，审计完整 | 复用 US-004 数据 |
| US-006 | 案件距 SLA 到期 23 小时 | 执行每日 02:00 扫描 | 专员与主管收到提醒，`slaState=DUE_SOON` | 调整 `sla_due_at` 数据 |
| US-007 | 交易入账 91 天前 | 打开交易详情 | 入口置灰，提示「超过 90 天的交易请致电客服」 | 交易 0000000000000199 |
| US-008 | account-service 停用 | 发起临时入账 299.00 | 503 `DOWNSTREAM_UNAVAILABLE`，案件保持 `UNDER_REVIEW`，余额不变 | 停用容器 |

## 执行证据要求

功能测试、静态工具检查、Agent Review、安全报告和问题复测分别记录实际命令/工具版本/代码commit/退出码/报告路径。Owner验收依据为这些实际结果；知识发布不表示已验收。
