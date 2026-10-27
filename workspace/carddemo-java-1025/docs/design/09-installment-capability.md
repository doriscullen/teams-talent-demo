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
- `installment_application_intent`（创建意图，本轮新增）：先落库的稳定作用单元，持有 `planId`（= ledger `entryGroupId`）、定价与状态 `PENDING/LEDGER_POSTED/COMPLETED/FAILED/REVERSED`。跨服务过账与本地建计划共用它，因此可安全续跑或冲正。
- `installment_repayment`（一期还款，本轮新增）：`payment_key` 幂等，记录真实还款金额与已冲减本金，状态 `PENDING/COMPLETED/FAILED`。
- 状态机：`ACTIVE → SETTLED | CANCELLED`；`PENDING → PAID`（还款计划行）；意图 `PENDING → LEDGER_POSTED → PAYMENT_APPLIED → COMPLETED`（结清）或 `PENDING → LEDGER_POSTED → COMPLETED`（创建）/`FAILED → REVERSED`（冲正）。禁止跳态、禁止直接改状态字段。

## 5. 接口契约

| 接口 | 方法 | 成功 | 关键错误 |
|------|------|------|----------|
| `/api/v1/installments/preview` | POST | 200 + `previewToken`/期次明细/总费/首期合计 | 404（越权/不属本账户）、409 `INSTALLMENT_NOT_ELIGIBLE`/`PRINCIPAL_EXCEEDS_LIMIT`/`ALREADY_INSTALLED`，400 `INVALID_TERM` |
| `/api/v1/installments/eligibility` | GET | 200 `{eligible,reason,alreadyInstalled,existingPlanId,minAmount}` | 404（越权） |
| `/api/v1/installments/bills/{accountId}` | GET | 200 `{billId,cycleStart,cycleEnd,billPrincipal,availablePrincipal,lines[]}` | 404（越权），503 |
| `/api/v1/installments/{planId}/repayments` | POST | 200 `{remainingPrincipal,principalApplied,paidInstallments,replayed}`（本金-only，支持部分归还并按期累计） | 409 `REPAYMENT_NOT_ALLOWED`/`IDEMPOTENCY_KEY_CONFLICT`/`SETTLEMENT_IN_PROGRESS`，400 `REPAYMENT_EXCEEDS_PRINCIPAL`/`INVALID_PARAMETER` |
| `/api/v1/installments/{planId}/settlement-quote` | GET | 200 `{remainingPrincipal,penaltyFee,feeRebate,settlementTotal}` | 409 `SETTLEMENT_NOT_ALLOWED` |
| `/api/v1/installments` | POST | 201（同键重放 200） | 409 `ALREADY_INSTALLED`/`INSTALLMENT_LIMIT_EXCEEDED`/`PREVIEW_EXPIRED`/`IDEMPOTENCY_KEY_CONFLICT`，400 `AGREEMENT_REQUIRED`，503 `DOWNSTREAM_UNAVAILABLE` |
| `/api/v1/installments` | GET | 200 `{items,page,size,total}` | 400 `INVALID_PARAMETER`，404（非本人） |
| `/api/v1/installments/{planId}` | GET | 200 计划+还款计划 | 404 `INSTALLMENT_NOT_FOUND` |
| `/api/v1/installments/{planId}/early-settlement` | POST | 200（同键重放 200 首次结果） | 409 `SETTLEMENT_NOT_ALLOWED`/`CONCURRENT_SETTLEMENT`/`CONCURRENT_MODIFICATION`，400 `INVALID_FEE_REBATE`，503 |
| `/api/v1/admin/installments` | GET | 200 `{items,page,size,total}`（真实分页并写查询审计） | 403 `FORBIDDEN`，400 `INVALID_PARAMETER` |
| `/api/v1/admin/installments/{planId}` | GET | 200 计划+还款计划+还款记录（写查看审计） | 403，404 |
| `/api/v1/admin/installments/notifications` | GET | 200 发件箱状态/失败原因/投递文件数 | 403 |
| `/api/v1/admin/installments/notifications/dispatch` | POST | 200 `{delivered}` | 403（非客服） |
| `/api/v1/admin/installments/notifications/{id}/requeue` | POST | 200 `{delivered,status}`：对已耗尽自动重试（5 次）的通知显式幂等重排并投递一次 | 403（非客服） |
| `/api/v1/admin/installments/notifications/sink` | POST | 200 `{sinkAvailable}`（本地投递目标可用性） | 403（非客服） |
| `/api/v1/admin/installments/audit-retries/replay` | POST | 200 `{replayed,pending}` | 403（非客服） |
| `/api/v1/admin/installments/exports` | POST | 200 `{exportId,rowCount,expiresAt}` | 403，400 |
| `/api/v1/admin/installments/exports/{id}` | GET | 200 `text/csv` | 410 `EXPORT_EXPIRED`，404 |
| `/api/v1/admin/installments/eligibility-flags` | POST | 200 | 403（只读身份） |
| `/api/v1/journal-entries`（ledger） | POST | 201/200 `duplicate` | 400 `INVALID_JOURNAL_ENTRY`（不平衡/金额非正/同组异内容） |

超时：下游 connect 500ms / read 2000ms（`installment.downstream.*`），超时即 `503 DOWNSTREAM_UNAVAILABLE`。
`previewToken`：自签名（HMAC），30 分钟有效，绑定账户/来源/本金/期数/费率；试算不落库。

## 6. 数据模型（新增表）

`installment_policy`（起分额/20 笔上限/违约金率/令牌与幂等窗口）、`installment_rate`（3/6/12 月费率）、`installment_plan`、`installment_schedule`、`installment_principal_allocation`、`installment_account_access`、`installment_permission`、`installment_account_lock`、`installment_eligibility_flag`、`installment_settlement_intent`、`installment_export_file`、`installment_audit_event`、`installment_audit_retry`、`installment_notification_outbox`；ledger：`ledger_entry_group`、`ledger_entry_line`。
本轮新增：`installment_application_intent`、`installment_repayment`（分期库）；`account_payment_effect`（账户库，effectId 去重）；通知发件箱增加 `sent_at/updated_at`；结清意图增加 `last_error`。
关键约束：`uk_installment_plan_idempotency`（去重键全局唯一）、`uk_installment_schedule(plan_id, installment_no)`、`installment_settlement_intent.settlement_key` 主键、`uk_installment_intent_plan`、**部分唯一索引 `uk_installment_settlement_active_plan(plan_id) WHERE status <> 'COMPLETED'`**（同一计划只允许一条在途结清）、`account_payment_effect.effect_id` 主键。
列类型对齐：`installment_plan.term_months`、`installment_schedule.installment_no` 由 `SMALLINT` 改为 `INT`（V3，对应实体 `int`），`installment_policy.id` 保持 `SMALLINT`（对应 `Short`）；真实 PostgreSQL 启动/迁移/Schema 校验由 `InstallmentSchemaValidationTest`（Testcontainers `postgres:16-alpine` + `ddl-auto=validate`）守护。

## 7. 事务、幂等与并发

**创建（US-001/002/003/007/AC-10/11，A-002/A-008）**
1. 幂等命中（按 `idempotencyKey` 查创建意图）：内容一致 → 续跑/重放；内容不一致（账户/来源/本金/期数）→ 409 `IDEMPOTENCY_KEY_CONFLICT`；命中已冲正意图 → 409；COMPLETED 且超过 30 分钟窗口 → 409 `IDEMPOTENCY_KEY_EXPIRED`（不新建）。
2. 校验 `previewToken`（签名/过期/参数一致）→ 协议勾选 → 期数/起分额 → 归属。
3. `installment_account_lock` 行级锁内**重查幂等键**（同键并发拿回同一意图）+ `count(ACTIVE)` ≥ 20 → 409 `INSTALLMENT_LIMIT_EXCEEDED`；随后落创建意图（`planId = IP + intentId`）。
4. ledger 过账（`entryGroupId = planId`，幂等；分录**借贷平衡**：DEBIT 1100 应收 = 本金+手续费，CREDIT 2100 客户应付 = 本金，CREDIT 4001 手续费收入 = 手续费）。
5. 独立事务内建计划 + 还款计划 + 占用记录（提交时**重新校验**来源入账状态、争议/逾期信号、本金占用与可分期本金），成功标记意图 COMPLETED。
6. 失败处理：下游 503 → 意图保持可续跑（`last_error` 记录），同键重试或对账 worker 续跑；
   业务性失败（本金已占用等）→ **先在独立事务持久化补偿阶段 `COMPENSATION_PENDING`**（补偿决定落库），
   再用稳定作用ID过账冲正组（`planId-REV`），成功后置 REVERSED。
   一旦进入 `COMPENSATION_PENDING`，同键重试与对账**只允许幂等完成同一逆向**：即使原拒绝原因（占用/争议标记）
   已解除，也绝不重新 postCreate/completePlan，因此不会出现「净分录为 0 却生成有效计划」。
   冲正未确认（失败或响应丢失）时保持 `COMPENSATION_PENDING`，恢复后续跑同一逆向；完成后调用方拿到
   `IDEMPOTENCY_KEY_CONFLICT`（该键已被消费，需新键）。
7. 审计 + 通知发件箱（失败不回滚），通知由投递 worker 真实发送。

**结清（US-005/AC-16/INS-08，A-001/A-005/A-006）**
1. `feeRebate` 由服务端固定 0.00：请求携带非零减免 → 400 `INVALID_FEE_REBATE`（客户/客服都不能改价）。
2. 计划行锁内建意图：非 ACTIVE → 409 `SETTLEMENT_NOT_ALLOWED`；同计划已有异键在途意图 → 409 `CONCURRENT_SETTLEMENT`（数据库部分唯一索引兜底）。
3. 同 `settlementKey` 且 COMPLETED → 200 返回首次结果（金额分解来自意图表，不重算、不重复还款、不重复分录）；同键异内容 → 409；
   意图 FAILED（已冲正）→ 409 `SETTLEMENT_FAILED`，需新键；在途判定只含 PENDING/LEDGER_POSTED/PAYMENT_APPLIED，
   FAILED 不占在途（与部分唯一索引一致）。
4. 步骤：ledger 过账（分组键 = `settlementKey`，平衡：DEBIT 1001 现金 = 本金+违约金，CREDIT 1100 应收 = 本金，CREDIT 4002 违约金收入 = 违约金）→ account `payments`（**effectId = `EffectIds.settlement(planId, settlementKey)`**，账户端去重）→ 计划 SETTLED + 意图 COMPLETED。任一步响应丢失都可在同键重试中续跑：ledger 幂等、账户端 effectId 去重，最终只有一次资金效果。
5. ledger 失败：503，计划保持 ACTIVE、未还款；账户端失败：503 且意图保留在途，重试续跑。

**本金-only 累计还款（A-003 / A-R002，按原文与 PRD BR-INS-10）**：`POST /{planId}/repayments`
1. 金额合同：接受任何不超过「未还本金合计」的合法金额（正数、最多两位小数）；不引入手续费分配政策，
   也不要求整期金额。计划锁内校验并落 `installment_repayment`（paymentKey 幂等；同键并发在锁后重核）。
2. 真实资金：account 真实还款（effectId = `EffectIds.repayment(planId, paymentKey)`）→ ledger
   `REPAY-<effectId>`（DEBIT 现金 / CREDIT 分期应收，金额等于本次归还本金）。
3. 回写：按最早未还期次累计 `installment_schedule.paid_principal`，每期累计达到 `principal_due` 才置 PAID；
   同步减少 `remaining_principal`，回写金额恒等于扣款金额（900/3 还 100 → remaining 800、第 1 期已还 100 未完成；
   再还 250 → 累计 350 → 第 1 期完成、第 2 期已还 50、remaining 550；独立新计划单次 350 同样得到一期完成+二期 50）。
4. 失败语义：账户/账务 5xx 或超时 → 保持 PENDING（账户可能已扣），既阻止结清也由对账续跑；
   账户业务拒绝（余额不足等）→ FAILED（0 资金效果）。**FAILED/PENDING 重试都在计划锁内先重核
   「计划仍 ACTIVE + 无在途结清」再触碰任何账户/账务**：计划已结清时旧 key 直接 409 `REPAYMENT_NOT_ALLOWED`，
   不会先扣款再报错；正常 ACTIVE 计划上的同键重试仍可恢复。
900/3 还 300 → 剩余 600、第 1 期 PAID，随后结清 600+6−0=606（原 US-005 不变）。

**本金资金动作互斥（A-R003）**：同一计划的还款与结清共用互斥，并且互斥覆盖**不同的 paymentKey**：
- 建结清意图时若存在 PENDING 还款 → 409 `REPAYMENT_IN_PROGRESS`；
- 建还款意图时若存在在途结清意图（PENDING/LEDGER_POSTED/PAYMENT_APPLIED）→ 409 `SETTLEMENT_IN_PROGRESS`；
- 建还款意图时若**同一计划存在其它 paymentKey 的 PENDING 还款** → 409 `REPAYMENT_IN_PROGRESS`（A-R003b）。
  因此同计划两个各 900 的还款键不会都扣款：第二个在远端资金动作之前被拒，账户/账务累计不超过实际合法归还本金。
- **在途占用先落库再做资金动作（A-R003a）**：新键与 FAILED/PENDING 重试都在计划锁事务内先把自己的
  `installment_repayment` 原子置为 PENDING 并提交，释放锁之后才调用 account/ledger。重试不再是「已过栅栏、
  仍是 FAILED、已放锁」，因此并发的结清在任何新资金动作前就拿到 409，而不是结清完才发现还有在途还款。
- **锁内新鲜读取（A-R003c）**：回写本金时先取共享计划锁，再以悲观写锁（`findForUpdate`）从数据库重新读取还款意图，
  不使用锁前读到的一级缓存旧快照；同 key 只应用一次，已完成的调用返回首次效果（`replayed=true`），
  账户扣款与本地回写都不会重复。
只控制金额不足/无在途本金时的**明确拒绝**才置 FAILED；响应未知/账务未完成保持 PENDING 供对账续跑，不提前清栅栏，
也不把栅栏扩成永久禁止（在途行完成后同键与其它键都可以继续）。

**账户作用ID（A-R004）**：`EffectIds` 按「操作类型 + 计划 + 客户端键」生成 `REPAY-<sha256前40位>` / `SETTLE-<sha256前40位>`，
服务端生成、操作命名空间分离，客户端键相同的还款与结清也不会碰撞；同键重放仍稳定。

**并发**：计划 `@Version` 乐观锁 + 结清/还款的计划行锁；20 笔上限由账户锁串行化；同键创建由账户锁内重查 + 唯一约束串行化。

## 8. 安全设计

| 维度 | 实现 |
|------|------|
| 认证 | `TokenAuthenticationFilter` 校验 IAM HMAC token（非 JWT），缺/坏/过期 401 |
| 主体来源 | token payload（userId/userType）；不使用请求体自报身份 |
| 归属 | `installment_account_access`；越权读取 404（不泄露存在性） |
| 后台权限 | `installment_permission`：STAFF_ASSIST 可写、RISK_READONLY 只读；无权限 403；不因 `userType=A` 放行 |
| 参数校验 | 金额/期数/枚举/分页在 controller + 领域双重校验；资格不从前端推导 |
| 日志与响应 | 不返回完整卡号；日志仅输出计划号/账户号/金额；token 不落日志 |
| 审计 | 创建/结清/还款/后台查询/后台详情/导出/导出下载写 `installment_audit_event`（actor/action/resource/payload/时间）。**写入在业务提交后、独立事务（REQUIRES_NEW）中执行**：INSERT 失败只回滚它自己，业务事务照常提交；失败记录写 `installment_audit_retry`（另一个独立事务），由 `AuditRetryWorker` 重放后清空。整个库不可用时业务事务本身失败，不伪造成功。 |
| 通知 | 本地投递适配器把通知真实写入投递目录（原子落盘）；目标不可用（`.offline` 标记）时状态为 FAILED 且记录 `last_error/attempts`。发件箱写入同样在提交后独立事务执行，INSERT 失败写 `installment_notification_retry` 并在下一轮重新入队。自动重试有界（5 次）；超过后由客服调用显式幂等重排接口（`notifications/{id}/requeue`）恢复，恢复后恰好投递一次，已 SENT 幂等无操作。待发送不等于已发送 |
| 导出 | 后台 CSV 走与其它接口相同的 Bearer 认证（前端 fetch 带 token 下载），下载与创建都写审计；只读事务内不做审计写 |

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
- `web-ui`：`/api/v1/installments`、`/api/v1/admin/installments` 代理；新增「我的分期」「我的账单（真实账单号/账期/可分期本金）」「申请分期（三步：期数→试算→确认，幂等键页面内稳定）」「分期详情（归还本期 + 结清试算→确认→取消）」「分期后台（真实分页+只读详情+带 Bearer 的 CSV 下载）」页面。交易详情入口按服务端 `eligibility` 投影渲染：低额/争议/逾期/未入账显示禁用与原因，已分期显示徽标与计划链接。

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
| 跨服务幂等/补偿 | §7 | A-001/A-002 | SettlementServiceTest、InstallmentApplicationServiceTest、AccountApplicationServiceTest、LedgerPostingServiceTest |
| 补偿阶段持久化与只逆向恢复 | §7 | A-R001 | InstallmentApplicationServiceTest（compensationPhaseNeverCompletesForward…、reconciliationOfCompensationPendingOnlyReverses） |
| 本金-only 累计还款 | §7 | A-R002、US-005 | RepaymentServiceTest、InstallmentScheduleTest |
| 还款/结清互斥与失败重试栅栏 | §7 | A-R003（a/b/c） | RepaymentServiceTest（failedRetryPersistsInFlightBeforeRemoteEffect、differentPaymentKeyIsRejectedWhileAnotherRepaymentIsInFlight、concurrentCompletionBeforeApplyIsNotAppliedTwice）、SettlementServiceTest；真实服务重叠：develop-rework-rt4.py |
| 操作作用ID | §7 | A-R004 | RepaymentServiceTest、EffectIds |
| FAILED 不占在途 | §7 | A-R005 | SettlementServiceTest（failedIntentDoesNotBlockNewSettlementKey） |
| 副作用事务边界（真实 PG 触发器） | §8 | R-C-01 | InstallmentSideEffectFailureTest（Testcontainers + 表级拒绝 INSERT） |
| 通知显式重排 | §8 | R-C-03 | NotificationWorkerTest、InstallmentSideEffectFailureTest |
| 一期还款回写 | §7 | A-003、US-005 | RepaymentServiceTest |
| 通知投递/补发 | §8 | C-03 | NotificationWorkerTest |
| 审计重试消费 | §8 | C-07 | AuditRetryWorkerTest |
| Schema 漂移防线 | §6 | verify 阻塞回归 | InstallmentSchemaValidationTest（真实 PG） |

## 12. 未覆盖与待确认（不在本期自行确认）

1. 正式费率/违约金/首期时点、占用口径正式签字、减免策略、账单与单笔叠加的产品规则、20 笔正式上限（PRD §12.3-1..5），仍按模拟值/测试口径实现。
2. `idempotencyKey` 超过 30 分钟窗口：PRD §12-6 未定正式错误码，本期按「拒绝旧键、不新建」实现为 409 `IDEMPOTENCY_KEY_EXPIRED`，正式码值仍待确认。
3. 生产鉴权（JWT/网关，§12-7）与统一权限中心（§12-8）未实施；本地权限表属演示实现。
4. 通知已实现本地真实投递（文件落盘 + 失败可见 + 自动补发 + 超限后客服显式重排），但未接入外部短信/推送厂商；正式通道与模板审核仍待 PRD §12 确认。
6. 还款按原文/PRD 实现本金-only 累计（支持部分归还）；手续费/利息如何随部分还款分配仍属 PRD §12 待确认，本轮不做手续费分配。
5. 性能指标（p95）未在本次单测阶段验证，需在隔离 Compose 环境压测（verify 节点）。
