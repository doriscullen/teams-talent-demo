# 餐饮消费返现（CATEGORY_CASHBACK）代码分析报告

## 仓库知识层次分类

本需求属于 CardDemo 微服务架构中的**营销支撑域（Marketing，新边界）**与三个存量域的横向集成：

- **Marketing 限界上下文（新支撑域，`marketing-service` :8087，库 `carddemo_marketing`）**：
  - `Campaign` 聚合根（活动规则 + 状态机 + 预算）
  - `Enrollment` 实体（报名，`(campaign_id, card_number)` 唯一）
  - `RewardGrant` 实体（发奖记录，`(campaign_id, transaction_id)` 唯一）
  - 领域服务 `EligibilityPolicy`（资格判定）、`RewardCalculator`（计价）
  - 应用服务 `RewardEvaluationService`（评估 + 发放编排）、`RewardController`（`POST /api/v1/reward-evaluations`、`POST /api/v1/rewards/{id}/fulfill`）
  - 出站适配器 `AccountClient`（读账户快照、写返现入账）
- **Transaction 限界上下文（`transaction-service` :8085）**：
  - `PostingService.post()`（日终入账用例 CBTRN02C，新增营销触发点）
  - `MarketingClient`（新增出站适配器，`POST /api/v1/reward-evaluations`）
- **Account 限界上下文（`account-service` :8084）**：
  - `AccountApplicationService.creditCashback()`（新增幂等返现入账用例）
  - `RewardCredit` 实体 + `reward_credit` 表（幂等键 `reward_id`）

层次定位：

> 营销能力（Marketing）→ 活动域（Campaign/Enrollment/RewardGrant）→ 评估用例（RewardEvaluationService）→ 资格策略（EligibilityPolicy）→ 计价器（RewardCalculator）→ 返现入账（account-service creditCashback）；交易域 → 入账用例（PostingService.post）→ 营销触发（MarketingClient.evaluateRewards）。

## 需求影响位置依赖分析

### 营销域（marketing-service）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `Campaign` | 被依赖聚合根 | `RewardEvaluationService.evaluate()`（`RewardEvaluationService.java:70-114`）循环调用 `campaigns.findActiveAt(now)` 获取；`campaign.consumeCashback()` 扣预算（:91）；`EligibilityPolicy.evaluateTransaction()` 读规则字段 |
| `EligibilityPolicy` | 静态领域服务 | `RewardEvaluationService.evaluate()` :80-82 调用 `evaluateTransaction()`；`Evaluation` record 承载 `eligible/reason/reward` |
| `RewardCalculator` | 静态领域服务 | `EligibilityPolicy.evaluateTransaction()`（`EligibilityPolicy.java` 内）调用 `compute()` 计算奖励 |
| `RewardComputation` | 值对象 record | `EligibilityPolicy` 产出、`RewardGrant` 构造函数消费（`RewardGrant.java:75-93`），区分 `CASHBACK`/`POINTS` |
| `CampaignRepository` | 端口接口 | `RewardEvaluationService` 注入（:40），`findActiveAt()` 只查 ACTIVE 且在期内 |
| `EnrollmentRepository` | 端口接口 | :76-78 `findEnrollment(campaignId, cardNumber)` 判定报名 |
| `RewardGrantRepository` | 端口接口 | :65 `existsByCampaignAndTransaction()`（幂等）、:79 `countByCampaignAndCard()`（每卡次数）、:112/:139 `saveReward()`、:120 `findReward()`（fulfill） |
| `AccountClient` | 出站适配器 | :63 `findAccount()`（快照）、:97/:124 `creditCashback()`（返现入账，幂等键 rewardId） |
| `Clock` | Spring 注入 | :44/:69/:127 `LocalDateTime.now(clock)`，可测时间源 |
| `RewardController` → `EvaluationRequest` | 入站适配器 | :45 `evaluate()` 将请求转为 `EvaluationCommand`；`RewardController.java:44-47` |
| `RewardGrant` | 被依赖实体 | 状态迁移 `markGranted/markPending`（:105-109），`isCashback()`（:115-117）决定是否调账户 |
| `RewardView` | 应用层 record | 封装 grant + campaignName 返回给接口层（:114/:141） |

### 交易域（transaction-service）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `MarketingClient` | 出站适配器（新增） | `PostingService.evaluateRewards()`（`PostingService.java:301-314`）调用，构造 `RewardEvaluationCommand` 并 `restClient.post()` 到 `/api/v1/reward-evaluations`（`MarketingClient.java:28`） |
| `PostingPolicy` | 领域服务 | `PostingService.post()` :260-261 校验卡/账户/额度/过期，先行于营销触发 |
| `TransactionRepository` / `DailyTransactionRepository` / `TranCategoryBalanceRepository` | 端口接口 | :242 `existsByTransactionId()` 入账幂等；:266/:289 写日交易；:274-279 类别累计 |
| `AccountClient`（transaction 域） | 出站适配器 | :281 `applyPosting()` 同步记账 |
| `TransactionIdGenerator` | 应用组件 | :248 无交易号时生成 16 位零填充交易号 |
| `@Value("${marketing.enabled:true}")` | 配置开关 | :221/:302 关闭开关可整体停止营销调用（ADR-009 回退路径） |

### 账户域（account-service）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `RewardCreditRepository` | 端口接口 | `AccountApplicationService.creditCashback()` :72 `existsByRewardId()` 幂等判断；:84 `saveCredit()` |
| `Account` | 聚合根 | :81-83 `getById()` + `applyCashback(amount)`（`Account.java:212-218`，余额可为负） |
| `AccountController` | 入站适配器 | `AccountController.java:74-79` 暴露 `POST /api/v1/accounts/{id}/cashback-credits`，入参 `CashbackCreditRequest` |
| `reward_credit` 表 | 数据库 | `V3__reward_credit.sql`（`:403-417`），`reward_id` 主键 + `account_id` 索引 |

### 关键交叉依赖

- transaction → marketing：`MarketingClient.evaluateRewards()`（同步 REST，`/api/v1/reward-evaluations`，2s 超时，失败仅告警）。
- marketing → account：`AccountClient.findAccount()`（读快照）+ `creditCashback()`（写返现，幂等键 rewardId）。
- web-ui → marketing：`ApiProxyController` 路由 `/api/v1/reward-evaluations`、`/api/v1/rewards` 等至 `marketing:8087`（见 grep 结果）。

## 调用跟踪

### 主链路：消费入账 → 返现（时序）

```
Transaction 日终入账（CBTRN02C）
  PostingService.post(List<PostingCommand>)
    │ 1. 交易号幂等检查：transactions.existsByTransactionId() → 已存在则计 duplicates 跳过
    │ 2. 无交易号时 TransactionIdGenerator 生成 16 位零填充
    │ 3. cardClient.findCard() → accountClient.findAccount() 解析卡/账户快照
    │ 4. PostingPolicy.evaluate() → 拒付则记 REJECTED（不中断整批）
    │ 5. balance.apply(amount) 类别累计 + accountClient.applyPosting() 记账 + 保存交易/日交易
    ▼
  evaluateRewards(record, card, command)   [本地事务已提交后]
    │  marketing.enabled 开关检查 → MarketingClient.evaluateRewards(Command)
    │  RestClientException → log.warn("Reward evaluation failed ...")，不回滚（ADR-009）
    ▼
Marketing RewardEvaluationService.evaluate(EvaluationCommand)
    │ validate() 参数校验（交易号/卡号16位/账户11位/金额>0）
    │ accountClient.findAccount() → null 则 ACCOUNT_NOT_FOUND 跳过
    │ now = clock；for (campaign : campaigns.findActiveAt(now))
    │   1. rewards.existsByCampaignAndTransaction() → true 记 ALREADY_EVALUATED 跳过（幂等）
    │   2. enrollments.findEnrollment() → enrolled
    │   3. rewards.countByCampaignAndCard() → rewardsOnCard
    │   4. EligibilityPolicy.evaluateTransaction(campaign, account, amount, category, enrolled, rewardsOnCard, now)
    │        └─ evaluateParticipation() 前置：NOT_ACTIVE / ACCOUNT_NOT_FOUND / ACCOUNT_INACTIVE / GROUP_MISMATCH / NOT_ENROLLED
    │        └─ CATEGORY_MISMATCH / AMOUNT_TOO_LOW / CARD_LIMIT_REACHED / ALREADY_REWARDED
    │        └─ RewardCalculator.compute() → REWARD_ZERO / BUDGET_EXHAUSTED 兜底
    │   5. 不满足 → skipped.add(reason)，continue（不中断其他活动）
    │   6. 满足 → campaign.consumeCashback(amount)（BusinessRuleException → BUDGET_EXHAUSTED 跳过）
    │   7. new RewardGrant(UUID, ...)（初始 PENDING）
    │   8. isCashback() ? accountClient.creditCashback(accountId, rewardId, campaignId, amount)
    │        ├─ 成功 → grant.markGranted(now)
    │        └─ RemoteServiceException → grant.markPending(...)（保持 PENDING 可重试）
    │   9. rewards.saveReward(grant); campaigns.saveCampaign(campaign)   [同一本地事务]
    ▼
Account AccountApplicationService.creditCashback(accountId, rewardId, campaignId, amount)
    │ rewardCredits.existsByRewardId() → true 直接返回当前账户（幂等，不重复扣减）
    │ account.applyCashback(amount) → currentBalance -= amount（余额可为负=溢缴）
    │ accounts.saveAccount(account); rewardCredits.saveCredit(RewardCredit(rewardId, ...))
    ▼
（失败路径）RewardEvaluationService.fulfill(rewardId)  [人工重试]
    findReward → NotFoundException(REWARD_NOT_FOUND)
    !isGranted() && isCashback() → 再次 creditCashback（幂等键兜底）→ markGranted
    RemoteServiceException → markPending + saveReward + 重新抛出（HTTP 503）
```

### 关键设计点

- **入账事务先提交、营销后触发**：`PostingService.post()` 在本地事务内完成交易+类别累计+账户余额后，`evaluateRewards()` 仍在方法体内但营销调用失败只 `log.warn`，不抛异常（`@Transactional` 默认 `RuntimeException` 回滚，但此处捕获 RuntimeException 吞掉，事务已正常提交）——这是 ADR-009 的“营销不阻塞账务”。
- **RewardEvaluationService 事务注解**：`@Transactional(noRollbackFor = RemoteServiceException.class)`（`RewardEvaluationService.java:37`）——账户返现调用失败时不回滚已保存的 PENDING grant。
- **fulfill 失败时显式 `rewards.saveReward(grant)` 后 `throw ex`**：利用 `noRollbackFor` 保留 PENDING 状态供再次重试。

## 需求分类

这是一个**新增业务能力（新特性开发）**：在存量 CardDemo（无营销能力）上新增“餐饮消费返现”活动场景，属 `docs/design/08-marketing-capability.md` 场景 S2：`CATEGORY_CASHBACK`，餐饮类别 0001、单笔 ≥50、返 5%、单笔上限 30、每卡最多 5 次、需报名。同时涉及**跨服务一致性设计**（ADR-009 的同步调用 + 幂等键方案），以及交易域、账户域的**侵入式扩展**（入账链路加触发点、账户新增返现入账用例）。

## 示例使用上下文

- **何时触发**：日终批量入账（`PostingService.post`）每笔交易成功后触发；也可由人工对单笔 PENDING 奖励调 `POST /api/v1/rewards/{rewardId}/fulfill` 重试。
- **调用方**：transaction-service（唯一评估调用方）、web-ui 代理（活动中心展示资格、奖励列表、重试按钮）。
- **为何重要**：返现是“消费事实之后的附加权益”（ADR-009），评估结果影响活动预算消耗（`consumedAmount`）、账户余额（冲减欠款）、发奖成功率指标。资格原因码（`skipped.reason`）直接展示给活动中心用户。
- **并发场景**：批量入账通常串行逐笔处理，但仍需数据库唯一约束兜底（`uk_reward_campaign_txn`）；预算消耗依赖 `@Version` 乐观锁（极端并发可能超发 1 笔，见 `08-marketing-capability.md` §8 风险）。

## 具体根因分析（如何）

- **为什么新增 marketing-service**：存量仓库没有任何营销能力（`08-marketing-capability.md` §1），四个场景（S1-S4）都从零构建，故 `Campaign/Enrollment/RewardGrant` 全部为新建文件，而非修改。
- **为什么改 transaction-service**：返现必须在“消费入账后”触发；入账用例 `PostingService.post()` 是唯一统一入口（日终 CBTRN02C），在此加触发点可覆盖所有交易，且能复用已解析的 `CardSnapshot/AccountSnapshot`（`card.customerId()` 等）构造评估命令。
- **为什么改 account-service**：余额是 Account 的聚合不变量，营销域“不保存账户余额”（§3），必须由 Account 执行入账；新增 `reward_credit` 幂等表是保证“同一奖励只入账一次”的唯一可行点（评估侧 `reward_grant` 唯一键无法覆盖 account-service 侧的重复调用）。
- **环境约束**：JDK 21 / Spring Boot 3.3.6 / PostgreSQL 16（H2 单测）、无 MQ（ADR-009 方案 A）、遗留标识零填充字符串、金额 `BigDecimal(12,2)`、时间 `LocalDateTime`、Flyway 迁移、每服务独立库（`07-java-conventions.md`）。
- **为什么资格判定做成纯静态服务**：`EligibilityPolicy` 不依赖 Spring、无 I/O，可被应用服务与纯 JUnit 单测直接调用；`RewardCalculator` 同理——符合“domain 不依赖框架”的依赖倒置约定（`07-java-conventions.md` §2）。

## 当前与预期行为

- **实现前**：交易入账完成后结束（`PostingService` 只有记账+类别累计）；账户只有余额变动（无返现概念）；无任何活动/报名/奖励数据模型。
- **实现后**：入账成功 → 同步评估活动 → 命中则发奖（cashback 直接入账/积分直接 GRANTED）；重复提交同一交易 → 幂等跳过（`ALREADY_EVALUATED`，不重复发奖/入账）；账户返现失败 → 奖励保持 PENDING，`fulfill` 可重试；营销整体不可用 → 入账照常、日志告警。
- **容易被忽略的独特方面**：
  1. `Campaign.consumeCashback()` 用 `LocalDateTime.now()`（`Campaign.java:209`）而非传入的 `now`，与 `applyDraft/activate` 用参数 `now` 不一致——这是刻意为之还是瑕疵需留意（`updatedAt` 语义）。
  2. `RewardEvaluationService` 事务内调外部账户服务（长事务持有锁），失败靠 `noRollbackFor` 保护——这是方案 A 的明确取舍。
  3. `PostingService` 的营销调用发生在**同一本地事务尚未提交的上下文内**（`evaluateRewards` 在 `post()` 方法体内被调用），但营销异常被捕获不抛出，因此不触发回滚；真正的“事务先提交”语义靠“异常被吞”实现，而非“事务提交后回调”。

## 需求实现逻辑（如何/为什么）

### 新增文件（marketing-service 全新域）

| 文件 | 责任 |
|---|---|
| `domain/model/Campaign.java` | 聚合根：状态机（DRAFT→ACTIVE⇄PAUSED→ENDED）、`applyDraft` 规则校验、`isActiveAt/matchesGroup/matchesCategory` 判定、`hasBudgetFor/consumeCashback/remainingBudget` 预算不变量 |
| `domain/model/Enrollment.java` | 报名实体，`(campaign_id, card_number)` 唯一约束 |
| `domain/model/RewardGrant.java` | 发奖实体，`(campaign_id, transaction_id)` 唯一约束，`PENDING→GRANTED/FAILED` 状态与 `failureReason` |
| `domain/model/CampaignDraft.java` | 规则草案 record（新建/编辑输入） |
| `domain/model/RewardComputation.java` | 计价结果 record（CASHBACK amount / POINTS points） |
| `domain/service/EligibilityPolicy.java` | 资格判定顺序 = 原因码优先级；`evaluateParticipation`（活动中心用）与 `evaluateTransaction`（交易后完整判定） |
| `domain/service/RewardCalculator.java` | 计价：固定额优先、比例 HALF_UP 保留 2 位、单笔封顶、积分向下取整 |
| `application/RewardEvaluationService.java` | 评估+发放编排、幂等、PENDING/重试 |
| `interfaces/rest/RewardController.java` | `reward-evaluations` / `rewards` / `fulfill` API |
| `infrastructure/client/AccountClient.java` | 账户快照读 + 返现入账写（幂等键 rewardId） |
| `infrastructure/persistence/RewardGrantJpaRepository.java` | Spring Data 适配，实现领域端口（exists/count/findRewards 分页） |
| `db/migration/V1__marketing_schema.sql` | campaign/enrollment/reward_grant 三表 + 唯一约束 + 索引 |

### 修改文件（存量域侵入）

| 文件 | 改动与为什么 |
|---|---|
| `transaction-service/.../PostingService.java` | `post()` 中每笔成功交易后调 `evaluateRewards()`；`marketingEnabled` 开关；失败告警不回滚（ADR-009） |
| `transaction-service/.../infrastructure/client/MarketingClient.java` | 新增出站适配器，`RestClient` POST 到 `/api/v1/reward-evaluations`，失败转 `RemoteServiceException` |
| `account-service/.../AccountApplicationService.java` | 新增 `creditCashback(accountId, rewardId, campaignId, amount)`：`existsByRewardId` 幂等 + `applyCashback` + 双写 |
| `account-service/.../domain/model/Account.java` | 新增 `applyCashback()`（冲减欠款，余额可为负） |
| `account-service/.../domain/model/RewardCredit.java` | 新增幂等记录实体 |
| `account-service/.../interfaces/rest/AccountController.java` | 新增 `POST /api/v1/accounts/{id}/cashback-credits` 端点 |
| `account-service/.../db/migration/V3__reward_credit.sql` | 新增 `reward_credit` 表（reward_id PK + account_id 索引） |

### 为什么这样分层

- 资格与计价放在 **domain/service**（无 Spring 依赖的纯逻辑），应用服务只做编排与事务，测试可直接针对领域服务（`EligibilityPolicyTest`/`RewardCalculatorTest` 为纯 JUnit）。
- 跨服务调用封装在 **infrastructure/client**（`AccountClient`/`MarketingClient`），应用层依赖端口而非 HTTP 细节，单测用 `@Mock` 替换。
- 幂等以**数据库唯一约束 + 先查后写**双重保障：评估侧 `uk_reward_campaign_txn`，入账侧 `reward_credit.reward_id` PK。

## 具体实现步骤

1. **建活动规则模型（Campaign 聚合根）**：定义 `campaign_type`（FIRST_PURCHASE_CASHBACK / CATEGORY_CASHBACK / POINTS_MULTIPLIER）、状态机、计价字段、预算字段；构造与 `applyDraft` 走同一 `validate(draft)`（按类型分支校验：固定额>0 / 比例≤100% 且预算>0 / 倍数>0）；`activate` 时校验未过期、现金返现预算>0。参考 `Campaign.java:103-277`。
2. **定义计价与资格判定（领域服务）**：`RewardCalculator.compute()` 区分积分（倍数向下取整）与现金（固定额优先→比例×金额 HALF_UP 2 位→单笔封顶 min）；`EligibilityPolicy` 按 MK-ELI 顺序判定并返回原因码（`Evaluation(eligible, reason, reward)`）。参考 `RewardCalculator.java:495-516`、`EligibilityPolicy.java:403-470`。
3. **建发奖记录（RewardGrant）**：构造时校验奖励>0；初始 `PENDING`；`markGranted/markPending/markFailed`；表唯一键 `(campaign_id, transaction_id)`。参考 `RewardGrant.java:75-109`、`V1__marketing_schema.sql:463-479`。
4. **写评估应用服务（RewardEvaluationService）**：构造注入 4 个仓储 + AccountClient + Clock；`evaluate()` 逐活动循环（幂等检查→报名/次数查询→资格判定→扣预算→建 grant→返现入账/直接 GRANTED→双保存）；`fulfill()` 重试 PENDING。参考 `RewardEvaluationService.java:58-142`。
5. **暴露评估/重试 API**：`POST /api/v1/reward-evaluations`（校验 DTO 转命令）、`GET /api/v1/rewards`、`POST /api/v1/rewards/{id}/fulfill`。参考 `RewardController.java:34-65`。
6. **交易入账触发点**：`PostingService.post()` 每笔 POSTED 后调 `evaluateRewards()`；`MarketingClient` 封装调用；`marketing.enabled` 开关 + catch RuntimeException 告警。参考 `PostingService.java:290-314`、`MarketingClient.java:28-56`。
7. **账户幂等返现入账**：`Account.applyCashback()` 冲减余额；`AccountApplicationService.creditCashback()` 先 `existsByRewardId` 后双写；`RewardCredit` 实体 + `V3` 迁移 + `cashback-credits` 端点。参考 `Account.java:212-218`、`AccountApplicationService.java:71-87`、`AccountController.java:73-79`、`V3__reward_credit.sql:1-9`。
8. **单元测试覆盖**：`RewardEvaluationServiceTest`（正常发奖、账户不可用 PENDING、幂等跳过、未报名跳过、fulfill 重试）；`EligibilityPolicyTest`（各原因码分支）；`RewardCalculatorTest`（固定额/比例/封顶/积分取整）。

## 需求实施检查清单

- [ ] 资格判定顺序是否与文档 MK-ELI-01..09 一致，且“命中第一个不满足即返回”？
- [ ] 现金返现是否同时校验：预算充足（`hasBudgetFor`）与类型（`isCashback`）？
- [ ] 计价精度：比例 `HALF_UP` 保留 2 位；积分 `DOWN` 取整；金额是否全部 `BigDecimal` 且数据库 `numeric(12,2)`？
- [ ] 幂等是否双重保障：评估侧 `(campaign_id, transaction_id)` 唯一 + 先查 `existsByCampaignAndTransaction`；入账侧 `reward_credit.reward_id` 唯一 + 先查 `existsByRewardId`？
- [ ] 账户返现失败时 grant 是否保持 `PENDING` 且已 `saveReward`（供 fulfill 重试）？`fulfill` 是否幂等（`isGranted()` 短路）？
- [ ] 入账失败是否不影响整批（单笔 REJECTED 继续后续命令）？营销失败是否不影响入账结果（catch + warn）？
- [ ] 交易号是否 16 位零填充字符串；卡号 16 位、账户 11 位校验是否与遗留约定一致？
- [ ] 乐观锁：`Campaign/RewardGrant/Enrollment/Account` 是否带 `@Version`（`version` 列）？
- [ ] 测试是否覆盖原因码（断言 `reason` 而非实现细节）与幂等（`verify(rewards, never()).saveReward`）？
- [ ] 是否遵循 `07-java-conventions.md`：包结构、领域异常 `BusinessRuleException("CODE", msg)`、`@Transactional` 边界、每服务独立库？

## 总结

本需求为存量 CardDemo 新增**营销支撑域（Marketing）**，实现“餐饮消费返现”场景：以 `Campaign` 聚合根承载活动规则与状态机（DRAFT→ACTIVE⇄PAUSED→ENDED）与预算不变量，`EligibilityPolicy` 按 MK-ELI 顺序判定资格（原因码即优先级），`RewardCalculator` 完成比例/固定/积分计价（HALF_UP 2 位、单笔封顶、积分向下取整），`RewardGrant` 以 `(campaign_id, transaction_id)` 唯一键保证评估幂等并承载 `PENDING→GRANTED/FAILED` 状态；`RewardEvaluationService` 编排评估、扣预算、调账户入账与失败重试（`fulfill`）；transaction-service 在 `PostingService.post()` 入账成功后同步触发评估（ADR-009：失败仅告警不回滚，`marketing.enabled` 可回退）；account-service 新增 `reward_credit` 幂等表与 `creditCashback` 用例，保证同一 `rewardId` 只入账一次。实现前系统无任何营销能力；实现后形成“入账→评估→发奖→入账”的同步调用链，以“本地事务 + 幂等键 + 人工重试”替代分布式事务（ADR-005/009），并通过 `@Version` 乐观锁、纯领域服务分层与纯 JUnit 单测保持架构一致性。
