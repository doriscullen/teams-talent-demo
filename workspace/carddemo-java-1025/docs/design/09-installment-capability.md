# 09 分期能力方案设计（REQ-2026-001）

| 项 | 内容 |
|----|------|
| 需求 | REQ-2026-001 信用卡账单/消费分期（任务 REQ-5118990a-c6d4-4df0-9974-55feda1bf515） |
| 输入 | PRD v1.1（`docs/requirements/REQ-2026-001-REQ-5118990a-…-revision-af3aecac.md`）+ 原始需求 v1.0 13 章 + test-profile v2 |
| 基线 | develop `72bc648`（含 `5eeddd6`）；JDK 21 / Spring Boot 3.5.16 / PostgreSQL / 原生 SPA |
| 决策 | ADR-010（分期与总账拆分）、ADR-011（最小账单能力）、ADR-012（认证与后台角色） |
| 档位 | L3（资金/账务/跨服务） |

## 1. 范围

In-scope：单笔消费分期与账单分期（3/6/12 期）、试算、提交、我的分期、提前结清、后台查询与 CSV 导出；手续费/违约金过账；审计与通知发件箱。
Out-of-scope（沿用原文 §3.1）：商户贴息、零费率活动、组合分期、逾期罚息与征信报送、多币种。

## 2. 架构决策摘要

| 决策 | 结论 | 依据 |
|------|------|------|
| 分期服务形态 | 新增 `installment-service`（8088，`carddemo_installment`） | ADR-010 |
| 总账形态 | 新增独立 `ledger-service`（8089，`carddemo_ledger`），按 entryGroupId 幂等；对分期服务是**真实可停用下游** | ADR-010、US-007 |
| 账单能力 | 分期服务内 `BillingStatementService`：账期以账户开卡日为锚点，交易来自 transaction-service | ADR-011、AC-09/AC-18 |
| 认证 | IAM HMAC token 过滤器，仅拦截分期接口；主体来自 token | ADR-012、AC-14 |
| 授权 | 客户按 `installment_account_access` 归属；后台 STAFF_ASSIST 可写 / RISK_READONLY 只读 | ADR-012、AC-21 |
| 余额 | 只经 account-service（`/payments`）变更；分期服务不直写账户库 | A-03、11.3 |
| 金额 | `BigDecimal` + `numeric(12,2)`；本金截断 2 位、末期吸收尾差；手续费 HALF_UP 2 位 | BR-INS-03R |
| 时间 | `Asia/Shanghai`；账期/应还日以账户开卡日号按月锚定并截断月末 | test-profile-v2、AC-18 |

## 3. 模块与分层

```
services/installment-service/src/main/java/com/carddemo/installment/
├── application/            # 用例与端口
│   ├── PreviewService / InstallmentApplicationService / InstallmentQueryService
│   ├── SettlementService / AdminExportService
│   └── port/ (AccountPort, TransactionPort, LedgerPort, BillingPort, AuditPort, NotificationPort, ClockProvider)
├── domain/
│   ├── model/ (InstallmentPlan, InstallmentSchedule, PrincipalAllocation, SettlementIntent, EligibilityFlag, …)
│   ├── service/ (FeeScheduleCalculator, EligibilityPolicy, SettlementCalculator)
│   ├── repository/ (Spring Data 接口)
│   └── exception/ (BusinessRule / NotFound / Forbidden / Unauthorized / RemoteService / ExportExpired)
├── infrastructure/
│   ├── client/ (AccountRestClient, TransactionRestClient, LedgerRestClient, HttpClientSupport)
│   ├── billing/ (BillingStatementService)
│   ├── security/ (HmacTokenVerifier, TokenAuthenticationFilter, AccessGuard, PreviewTokenService)
│   └── support/ (AuditEventWriter, NotificationOutboxWriter, SystemClockProvider)
└── interfaces/rest/ (InstallmentController, AdminInstallmentController, GlobalExceptionHandler, ApiError)
```

依赖方向：`interfaces → application → domain`；`infrastructure` 实现 `application.port` 与 `domain.repository`，不被领域反向依赖（符合 `docs/design/07-java-conventions.md`）。

## 4. 领域模型与状态机

- `installment_plan`（聚合根）：本金、期数、月费率、总手续费、剩余本金、状态、去重键、结清幂等键、乐观锁 `version`。
- `installment_schedule`：每期应还日/本金/手续费/合计；`Σprincipal_due = principal`，`Σtotal_due = principal + total_fee`。
- `installment_principal_allocation`：**本金级去重**。单笔分期与账单分期共用该表，因此「已单笔再计入账单」与「已账单再单笔」双向都被阻止；同时支持「已关联/未关联本金」对账。
- 状态机：`ACTIVE → SETTLED | CANCELLED`；`PENDING → PAID`（还款行）。禁止跳态、禁止直接改状态字段。

## 5. 接口契约

| 接口 | 方法 | 成功 | 关键错误 |
|------|------|------|----------|
| `/api/v1/installments/preview` | POST | 200 + `previewToken`/期次明细/总费/首期合计 | 409 `INSTALLMENT_NOT_ELIGIBLE`/`PRINCIPAL_EXCEEDS_LIMIT`/`ALREADY_INSTALLED`，400 `INVALID_TERM` |
| `/api/v1/installments` | POST | 201（同键重放 200） | 409 `ALREADY_INSTALLED`/`INSTALLMENT_LIMIT_EXCEEDED`/`PREVIEW_EXPIRED`/`IDEMPOTENCY_KEY_CONFLICT`，400 `AGREEMENT_REQUIRED`，503 `DOWNSTREAM_UNAVAILABLE` |
| `/api/v1/installments` | GET | 200 `{items,page,size,total}` | 400 `INVALID_PARAMETER`，404（非本人） |
| `/api/v1/installments/{planId}` | GET | 200 计划+还款计划 | 404 `INSTALLMENT_NOT_FOUND` |
| `/api/v1/installments/{planId}/early-settlement` | POST | 200（同键重放 200 首次结果） | 409 `SETTLEMENT_NOT_ALLOWED`/`CONCURRENT_MODIFICATION`，503 |
| `/api/v1/admin/installments` | GET | 200 | 403 `FORBIDDEN` |
| `/api/v1/admin/installments/exports` | POST | 200 `{exportId,rowCount,expiresAt}` | 403，400 |
| `/api/v1/admin/installments/exports/{id}` | GET | 200 `text/csv` | 410 `EXPORT_EXPIRED`，404 |
| `/api/v1/admin/installments/eligibility-flags` | POST | 200 | 403（只读身份） |
| `/api/v1/journal-entries`（ledger） | POST | 201/200 `duplicate` | 400 |

超时：下游 connect 500ms / read 2000ms（`installment.downstream.*`），超时即 `503 DOWNSTREAM_UNAVAILABLE`。
`previewToken`：自签名（HMAC），30 分钟有效，绑定账户/来源/本金/期数/费率；试算不落库。

## 6. 数据模型（新增表）

`installment_policy`（起分额/20 笔上限/违约金率/令牌与幂等窗口）、`installment_rate`（3/6/12 月费率）、`installment_plan`、`installment_schedule`、`installment_principal_allocation`、`installment_account_access`、`installment_permission`、`installment_account_lock`、`installment_eligibility_flag`、`installment_settlement_intent`、`installment_export_file`、`installment_audit_event`、`installment_audit_retry`、`installment_notification_outbox`；ledger：`ledger_entry_group`、`ledger_entry_line`。
关键约束：`uk_installment_plan_idempotency`（去重键全局唯一）、`uk_installment_schedule(plan_id, installment_no)`、`installment_settlement_intent.settlement_key` 主键。

## 7. 事务、幂等与并发

**创建（US-001/002/003/007/AC-10/11）**
1. 先查 `idempotencyKey`：命中且同账户 → 200 返回首次计划；命中但不同账户 → 409 `IDEMPOTENCY_KEY_CONFLICT`（防止跨客户重放）。
2. 校验 `previewToken`（签名/过期/参数一致）→ 协议勾选 → 期数/起分额 → 归属。
3. `installment_account_lock` 行级锁 + `count(ACTIVE)` ≥ 20 → 409 `INSTALLMENT_LIMIT_EXCEEDED`。
4. 解析本金占用（单笔一笔；账单按最早未占用交易逐笔分摊），生成计划 + 还款计划 + 占用记录。
5. ledger 过账手续费（分组键 = planId，幂等）。**失败抛 503 → 本地事务回滚，无计划/还款计划/占用落库**，app 不产生余额变更。
6. 审计 + 通知发件箱（失败不回滚）。

**结清（US-005/AC-16/INS-08）**
1. 同 `settlementKey` 且 `COMPLETED` → 200 返回首次结果（金额分解来自意图表，不重算、不重复还款、不重复分录）。
2. 不同新键且计划非 ACTIVE → 409 `SETTLEMENT_NOT_ALLOWED`。
3. 试算 `penalty = 剩余本金 × 1%`（HALF_UP），`feeRebate` 默认 0.00，`结算额 = 本金 + 违约金 − 减免`。
4. 步骤：写意图（PENDING）→ ledger 过账（同键幂等）→ 标记 LEDGER_POSTED → account `payments` 归还本金**一次** → 计划 SETTLED + 意图 COMPLETED。ledger 失败：503，计划保持 ACTIVE、未还款。

**并发**：计划 `@Version` 乐观锁，冲突 → 409 `CONCURRENT_MODIFICATION`；20 笔上限由账户锁串行化。

## 8. 安全设计

| 维度 | 实现 |
|------|------|
| 认证 | `TokenAuthenticationFilter` 校验 IAM HMAC token（非 JWT），缺/坏/过期 401 |
| 主体来源 | token payload（userId/userType）；不使用请求体自报身份 |
| 归属 | `installment_account_access`；越权读取 404（不泄露存在性） |
| 后台权限 | `installment_permission`：STAFF_ASSIST 可写、RISK_READONLY 只读；无权限 403；不因 `userType=A` 放行 |
| 参数校验 | 金额/期数/枚举/分页在 controller + 领域双重校验；资格不从前端推导 |
| 日志与响应 | 不返回完整卡号；日志仅输出计划号/账户号/金额；token 不落日志 |
| 审计 | 创建/结清/导出/导出下载写 `installment_audit_event`（actor/action/resource/payload/时间），写失败入 `installment_audit_retry` |

## 9. NFR 应答

| 维度 | 目标 | 设计应答 | 验证 |
|------|------|----------|------|
| 性能 | 试算 p95 < 300ms；创建 < 1200ms；列表（size=100）< 800ms | 试算纯计算 + 单次交易查询；创建一次 ledger 调用；列表索引 `(account_id,status)` | 单测 + 本地 Compose 压测（verify 节点执行） |
| 一致性 | 金额 2 位、合计一致、无半完成状态 | 本金截断+末期吸收；总额 HALF_UP；创建失败回滚；结清意图分步 | 单测（19.25/6.00/3.26）、对账 SQL |
| 幂等 | 创建/结清重复请求返回首次结果 | 唯一去重键、结清意图表、ledger entryGroupId 幂等 | US-002/AC-16/AC-20 |
| 可用性 | 下游不可用返回明确错误码 | 503 + 事务回滚；ledger 真实可停 | US-007 |
| 可观测 | traceId、计划号、指标 | actuator/metrics + 业务日志含 planId | 运行检查 |

## 10. 与基线集成

- `pom.xml` 新增 `services/installment-service`、`services/ledger-service` 模块。
- `docker-compose.yml` 新增两服务（8088/8089）与 web-ui 代理配置；`docker/postgres/init/01-databases.sql` 新增 `carddemo_installment`、`carddemo_ledger`。
- `transaction-service`：`TransactionResponse` **新增 `status` 字段**（分期资格判断需要真实 POSTED 状态；原文 §11.2 要求交易响应增加分期资格相关字段）。
- `iam-service`：新增 `V3__installment_roles.sql`（ADMIN002=客服、ADMIN003=风控只读、USER0002=第二客户）提供真实登录身份；相应种子数量断言已更新。
- `web-ui`：`/api/v1/installments`、`/api/v1/admin/installments` 代理；新增「我的分期」「申请分期（三步：期数→试算→确认）」「分期详情/提前结清」「分期后台（查询+导出）」页面；交易详情增加「申请分期」入口，账单支付页增加「账单分期」入口。

## 11. 需求覆盖矩阵

| 功能点 | 设计章节 | 验收 | 单测 |
|--------|----------|------|------|
| REQ-INS-01 交易入口 | §5、§8 | US-006、AC-17 | EligibilityPolicyTest、PreviewServiceTest |
| REQ-INS-02 账单入口 | §2（ADR-011）、§5 | AC-09 | BillingStatementServiceTest |
| REQ-INS-03 试算 | §5、§7 | US-001、AC-12、AC-13 | FeeScheduleCalculatorTest、PreviewServiceTest、PreviewTokenServiceTest |
| REQ-INS-04 提交 | §7 | US-001/002/003/007、AC-10/11/14/19/20 | InstallmentApplicationServiceTest、InstallmentControllerTest |
| REQ-INS-05 我的分期 | §5、§7 | US-004、AC-15 | InstallmentQueryServiceTest |
| REQ-INS-06 提前结清 | §7 | US-005、AC-16 | SettlementServiceTest、SettlementCalculatorTest |
| REQ-INS-07 后台查询导出 | §5、§8 | US-008、AC-21 | AdminExportServiceTest、AccessGuardTest |
| 权限/SoD | §8 | AC-14/15/21 | AccessGuardTest、TokenAuthenticationFilterTest、HmacTokenVerifierTest |

## 12. 未覆盖与待确认（不在本期自行确认）

1. 正式费率/违约金/首期时点、占用口径正式签字、减免策略、账单与单笔叠加的产品规则、20 笔正式上限（PRD §12.3-1..5），仍按模拟值/测试口径实现。
2. `idempotencyKey` 超过 30 分钟窗口的重放错误码（PRD §12-6）未定义，本期不提供该分支的对外断言。
3. 生产鉴权（JWT/网关，§12-7）与统一权限中心（§12-8）未实施；本地权限表属演示实现。
4. 通知仅落发件箱，未接入真实短信/推送通道（基线无 notification 服务）；投递 worker 属后续迭代。
5. 性能指标（p95）未在本次单测阶段验证，需在隔离 Compose 环境压测（verify 节点）。
