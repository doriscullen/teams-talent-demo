# 跨服务幂等入账与失败重试：奖励发放代码分析报告

> 场景：跨服务奖励幂等入账 —— 重复评估检查、账户入账去重、失败保留待处理状态及人工重试。
> 依据：代码片段 01（reward-orchestration）、02（account-credit）、03（tests），并结合代码仓已提交代码验证。

## 一、仓库知识层次分类

本需求属于 CardDemo 微服务架构中 **Marketing 支撑域（营销奖励发放）** 与 **Account 存量域（账户入账）** 的跨服务集成，核心是一个"分布式一致性"用例：

- **Marketing 限界上下文（`marketing-service`，出站消费方）**：
  - `RewardEvaluationService`（应用服务）—— 评估 + 发放编排，新增文件
  - `RewardGrant`（发奖记录实体，`(campaign_id, transaction_id)` 唯一）—— 评估侧幂等载体，新增文件
  - `RewardGrantRepository`（仓储端口，`RewardGrantJpaRepository` 实现）—— 新增文件
  - `AccountClient`（出站适配器，`account-service` 客户端）—— 读快照 + 返现入账，新增文件
  - `V1__marketing_schema.sql`（`reward_grant` 等表）—— 新增迁移
- **Account 限界上下文（`account-service`，入账提供方）**：
  - `AccountApplicationService.creditCashback()` —— 幂等返现入账用例，新增方法
  - `RewardCredit` 实体 + `reward_credit` 表（`reward_id` 主键）—— 入账侧幂等载体，新增文件
  - `RewardCreditRepository` 端口 + `RewardCreditJpaRepository` 实现 —— 新增文件
  - `V3__reward_credit.sql` —— 新增迁移
- **Transaction 域（触发方，代码仓验证）**：`PostingService.evaluateRewards()` + `MarketingClient` 为入账后的营销触发点（片段外，见仓库已提交代码 `PostingService.java:137-150`）。

层次定位：

> 营销能力（Marketing）→ 发奖用例（RewardEvaluationService）→ 幂等检查（RewardGrantRepository.existsByCampaignAndTransaction）→ 发奖记录（RewardGrant）→ 账户入账（AccountApplicationService.creditCashback）→ 入账幂等（RewardCredit）；失败路径 → 人工重试（RewardEvaluationService.fulfill → creditCashback）。

## 二、需求影响位置依赖分析

### Marketing 域（marketing-service）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `RewardGrantRepository` | 端口接口 | `RewardEvaluationService.evaluate()` `:71` `existsByCampaignAndTransaction()` 重复评估检查；`:79` `countByCampaignAndCard()`；`:112`/`:135` `saveReward()`；`:120` `findReward()`（fulfill） |
| `AccountClient` | 出站适配器 | `:63` `findAccount()` 读账户快照；`:103`/`:130` `creditCashback()` 返现入账（幂等键 rewardId） |
| `Clock` | Spring Bean | `:69` `LocalDateTime.now(clock)`；注入使测试可控时间 |
| `RewardGrant` | 实体 | 状态迁移 `markGranted/markPending`（`:105-108`）、`isCashback()`（`:115-117`）决定是否调账户 |
| `Campaign`/`Enrollment` 聚合根 | 被依赖聚合根 | `campaign.consumeCashback()` 扣预算（`:91`）；`enrollments.findEnrollment()` 报名判定（`:76`） |
| `RewardController`（入站） | REST 入口 | `RewardController.java:44-47` 评估入口；`:62-65` `fulfill` 重试入口（仓库已提交） |

### Account 域（account-service）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `RewardCreditRepository` | 端口接口 | `creditCashback()` `:78` `existsByRewardId()` 幂等判断；`:84` `saveCredit()` 记录入账事实 |
| `Account` 聚合根 | 被依赖聚合根 | `:82` `applyCashback(amount)`（`Account.java:118-124`，冲减欠款、余额可为负） |
| `AccountController` | 入站适配器 | `AccountController.java:74-79` 暴露 `POST /api/v1/accounts/{id}/cashback-credits`，入参 `CashbackCreditRequest`（`rewardId` 幂等键） |
| `reward_credit` 表 | 数据库 | `V3__reward_credit.sql`，`reward_id` 主键 + `account_id` 索引 |

### 关键交叉依赖

- marketing → account：`AccountClient.creditCashback()`（同步 REST，3s 读超时 `RestClientConfig.java:18`；`RemoteServiceException` 包装）。
- 幂等键语义贯穿三处：评估侧 `(campaign_id, transaction_id)` → 发奖记录唯一；入账侧 `reward_id` → 入账记录主键；`fulfill` 重试靠"已 GRANTED 短路 + 入账侧幂等键兜底"。

## 三、调用跟踪

### 主链路：评估 → 入账（时序）

```
RewardEvaluationService.evaluate(EvaluationCommand)
  │ validate()：transactionId 非空、cardNumber \d{16}、accountId \d{11}、amount > 0（InvalidRequestException）
  │ accountClient.findAccount() → 无则 skipped(ACCOUNT_NOT_FOUND)
  │ for (campaign : campaigns.findActiveAt(now))                    [逐活动]
  │   1. rewards.existsByCampaignAndTransaction() → true：skipped(ALREADY_EVALUATED)，continue   ← 重复评估检查
  │   2. enrollments.findEnrollment() / countByCampaignAndCard() → 参与资格
  │   3. EligibilityPolicy.evaluateTransaction() → 不满足：skipped(reason)，continue
  │   4. campaign.consumeCashback()（BusinessRuleException → BUDGET_EXHAUSTED 跳过）
  │   5. new RewardGrant(UUID, ..., PENDING)
  │   6. isCashback() ?
  │        ├─ true：accountClient.creditCashback(accountId, rewardId, campaignId, amount)
  │        │     ├─ 成功 → grant.markGranted(now)
  │        │     └─ RemoteServiceException → grant.markPending("Cashback credit pending: ...")   ← 失败保留待处理
  │        └─ false（积分）：grant.markGranted(now)
  │   7. rewards.saveReward(grant); campaigns.saveCampaign(campaign)   [同一本地事务，noRollbackFor=RemoteServiceException]
  ▼
Account AccountApplicationService.creditCashback(accountId, rewardId, campaignId, amount)
  │ rewardCredits.existsByRewardId(rewardId) → true：直接 getById 返回          ← 入账去重
  │ account.applyCashback(amount)（currentBalance -= amount，余额可为负=溢缴）
  │ accounts.saveAccount(account) → rewardCredits.saveCredit(RewardCredit(...))  [先账户后幂等记录，同一事务]
```

### 失败路径：人工重试

```
RewardEvaluationService.fulfill(rewardId)
  │ rewards.findReward() → 无：NotFoundException(REWARD_NOT_FOUND)
  │ grant.isGranted() → true：短路返回（不再调账户）
  │ 非 granted：
  │    ├─ 积分：markGranted(now)
  │    └─ 现金：accountClient.creditCashback(...)（account 侧幂等键兜底）
  │         ├─ 成功 → markGranted(now)
  │         └─ RemoteServiceException → markPending(reason) + saveReward + throw ex（保留 PENDING，HTTP 503）
```

## 四、需求分类

这是一个**新特性开发（新增跨服务业务能力）**：在存量 CardDemo 上新增"营销奖励发放"，核心挑战是**跨服务幂等**（评估幂等 + 入账幂等）与**下游失败不丢账**（PENDING 状态 + 人工重试）。对应需求条目 MK-REW-01..08（评估/发放/幂等）与 NR-REWARD-01（账户幂等入账）。

## 五、示例使用上下文

- **何时触发**：交易入账成功后由 transaction-service 同步调用 `POST /api/v1/reward-evaluations`（`PostingService.evaluateRewards()`，营销失败仅 log.warn 不回滚——ADR-009）；PENDING 奖励由运营经 `POST /api/v1/rewards/{rewardId}/fulfill` 人工重试。
- **为何重要**：返现是"消费事实之后的附加权益"，营销域与账务域失败域必须分离；幂等键设计同时服务同步重试与未来事件重放（ADR-009 理由 3）。
- **并发场景**：批量入账通常逐笔串行，但 `uk_reward_campaign_txn` 唯一约束兜底并发重复评估；`@Version` 乐观锁保护预算消耗。

## 六、具体根因分析（如何）

- **为什么两处幂等**：评估侧唯一键 `(campaign_id, transaction_id)` 只能保证"同一活动同一交易评估一次"，无法覆盖 account-service 侧被重复调用（网络重放、跨服务重试）；account 侧必须以业务幂等键 `reward_id` 再保证一次"同一奖励只入账一次"。注释明确这一分工：`RewardEvaluationService.java:34-35`。
- **为什么失败保留 PENDING 而非回滚**：账户服务不可用时已消耗的活动预算与发奖记录不应回滚丢弃；`@Transactional(noRollbackFor = RemoteServiceException.class)`（`:37`）使事务提交、保留 PENDING，供人工重试。
- **为什么先查后写双保险**：`existsByCampaignAndTransaction` / `existsByRewardId` 是应用层快速路径，数据库唯一约束/主键是并发兜底——检查防重复、约束防竞态。
- **环境约束**：JDK 21 / Spring Boot 3.3 / PostgreSQL（H2 单测）、无 MQ（ADR-009 方案 A：本地事务 + 同步调用 + 幂等键 + 人工重试）；标识零填充字符串（交易号 16 位、卡号 16 位、账户 11 位）；金额 `BigDecimal(12,2)`；时间 `LocalDateTime`；每服务独立库、禁止跨库 JOIN（`07-java-conventions.md`）。

## 七、当前与预期行为

- **实现前**：账户仅有记账/还款/利息入账用例，无返现概念；营销域无发奖记录；跨服务无幂等写入。
- **实现后**：
  1. 同一活动同一交易重复评估 → `ALREADY_EVALUATED` 跳过，不重复发奖（`RewardEvaluationServiceTest.isIdempotentPerCampaignAndTransaction`，`verify(rewards, never()).saveReward()`）。
  2. 同一 `rewardId` 重复入账 → 账户余额只变一次（`AccountControllerTest.cashbackCreditIsIdempotentPerRewardId`，第二次余额不变）。
  3. 账户服务不可用 → 奖励 PENDING + failureReason，`fulfill` 重试成功转 GRANTED（`keepsPendingWhenAccountUnavailable`、`fulfilsPendingCashback`）。
- **容易被忽略的独特方面**：
  1. 入账顺序"先账户后幂等记录"（`AccountApplicationService.java:82-85`）：若先记 credit 后入账失败，会留下"已入账"的假记录；当前顺序失败时整事务回滚，两者都不会残留。
  2. `fulfill` 失败时显式 `rewards.saveReward(grant)` 后 `throw ex`：利用 `noRollbackFor` 把 PENDING 状态落库再让调用方看到 503。
  3. 积分奖励不走账户调用直接 GRANTED，`evaluate()` 与 `fulfill()` 都分支处理 `isCashback()`。
  4. 金额断言一律 `isEqualByComparingTo`，避免 BigDecimal 等值比较陷阱。

## 八、需求实现逻辑（如何/为什么）

- **`RewardEvaluationService`（新增，application 层）**：编排"校验 → 幂等检查 → 资格 → 扣预算 → 建记录 → 入账 → 落库"。循环内每个失败点转 `skipped`/`PENDING` 而不是向上抛，保证单活动失败不中断整批（`:70-115`）。
- **`RewardGrant`（新增，domain 层）**：状态机 `PENDING → GRANTED / FAILED`（`RewardStatus.java`），`markGranted/markPending/markFailed` 封装状态迁移并维护 `failureReason`/`grantedAt`；构造校验奖励 > 0；`@Version` 乐观锁；表唯一约束 `uk_reward_campaign_txn`（`V1__marketing_schema.sql:505`）。
- **`AccountClient`（新增，infrastructure 层）**：`findAccount()` 用 `RestClient.exchange()` 区分 404（返回 empty）与其他非 2xx（抛 `RemoteServiceException`）；`creditCashback()` POST 入账。RestClient 由 `RestClientConfig` 装配（3s 读超时）。
- **`AccountApplicationService.creditCashback()`（account 域新增用例）**：`existsByRewardId` 短路 → `applyCashback` → 先存账户后存 `RewardCredit`（同一 `@Transactional`）。
- **`RewardCredit` + `reward_credit` 表（新增）**：`reward_id` 主键即幂等键，附 `account_id` 索引支持按账户查询。
- **测试（03-tests.patch）**：account 侧 `@SpringBootTest` + MockMvc 端到端验证幂等（真实数据库约束生效）；marketing 侧 `@ExtendWith(MockitoExtension.class)` 单测桩仓储/客户端，固定 `Clock` 验证 GRANTED/PENDING/幂等跳过/fulfill，`ArgumentCaptor` 校验保存内容。

## 九、具体实现步骤

1. **定义发奖记录实体与唯一约束**（幂等载体）：`RewardGrant`（`rewardId` UUID 主键、`(campaign_id, transaction_id)` 唯一约束、`@Version`），状态方法封装迁移；`RewardStatus` 枚举 PENDING/GRANTED/FAILED。目的：评估侧重复评估在数据库层不可行。
2. **定义仓储端口与实现**：`RewardGrantRepository`（`existsByCampaignAndTransaction`、`countByCampaignAndCard`、`findReward`、`saveReward` 等），`RewardGrantJpaRepository` 以 default 方法桥接 Spring Data 派生查询。目的：domain 依赖倒置，不含 Spring 注解。
3. **编写评估编排（应用服务）**：`RewardEvaluationService.evaluate()` —— 参数校验 → 读账户快照 → 逐活动（幂等检查 → 资格判定 → 扣预算 → 建 grant → 按类型入账/直接 GRANTED → 落库）；类级 `@Transactional(noRollbackFor = RemoteServiceException.class)`。目的：单活动失败不中断整批，下游失败保留 PENDING。
4. **编写出站适配器**：`AccountClient.creditCashback(accountId, rewardId, campaignId, amount)` POST `/api/v1/accounts/{id}/cashback-credits`，`RestClientException` 包装为 `RemoteServiceException`；`findAccount()` 区分 404。目的：隔离 HTTP 细节，异常语义统一。
5. **下游账户幂等入账**：`AccountApplicationService.creditCashback()` 先 `existsByRewardId` 短路（幂等键），再 `applyCashback` 冲减欠款，先存账户后存 `RewardCredit` 幂等记录；`RewardCredit` 以 `reward_id` 为主键。目的：同一奖励只入账一次，重复调用无害。
6. **提供人工重试入口**：`RewardEvaluationService.fulfill(rewardId)` —— 记录不存在抛 404；`isGranted()` 短路；现金重调账户（入账侧幂等键兜底），失败 `markPending` + 保存 + 抛 503。对应 REST `POST /api/v1/rewards/{rewardId}/fulfill`。目的：PENDING 治理的闭环入口。
7. **数据库迁移**：marketing `V1__marketing_schema.sql` 建 `reward_grant`（唯一约束 + 查询索引）；account `V3__reward_credit.sql` 建 `reward_credit`（`reward_id` PK + `account_id` 索引）。目的：幂等约束落在数据库层，Flyway 版本化演进。
8. **测试覆盖幂等与失败路径**：account 侧 MockMvc 端到端重复调用断言余额不变；marketing 侧 Mockito 断言 `never().saveReward()`（重复评估）、PENDING + failureReason（下游失败）、fulfill 成功转 GRANTED。

## 十、需求实施检查清单

- [ ] 幂等键在**两端**都落地：评估侧 `(campaign_id, transaction_id)` 唯一约束 + `exists` 检查；入账侧 `reward_id` 主键 + `exists` 检查。
- [ ] 下游失败**不丢失**：事务 `noRollbackFor = RemoteServiceException`；失败记录 PENDING + failureReason；重试入口 `fulfill` 存在且 `isGranted()` 短路。
- [ ] 先查后写、先账户后幂等记录的顺序正确（避免残留假"已入账"记录）。
- [ ] 金额全程 `BigDecimal`，比较用 `compareTo/signum`，测试断言 `isEqualByComparingTo`。
- [ ] 异常语义统一：参数错 `InvalidRequestException`(400)、记录不存在 `NotFoundException`(404)、下游不可用 `RemoteServiceException`(503)；错误体 `{"code","message","details"}`。
- [ ] 时间源注入 `Clock` 保证测试可控；不打印卡号等敏感字段到日志。
- [ ] 迁移脚本可重放（Flyway），表名/字段与数据字典对应，`@Column` 与 SQL 一一对应。

## 十一、总结

这是一个跨服务幂等入账的新特性：marketing-service 新增 `RewardEvaluationService` 编排"评估 → 发奖 → 入账"，以 `RewardGrant` 的 `(campaign_id, transaction_id)` 唯一约束 + `exists` 检查保证评估侧幂等；account-service 新增 `AccountApplicationService.creditCashback()`，以 `RewardCredit.reward_id` 主键 + `exists` 检查保证入账侧去重；下游失败通过 `@Transactional(noRollbackFor = RemoteServiceException.class)` 保留 PENDING 状态，并由 `RewardEvaluationService.fulfill()` 提供人工重试闭环。实现遵循 DDD 分层（interfaces → application → domain ← infrastructure）、仓储端口依赖倒置、统一领域异常、Flyway 迁移与 `BigDecimal/LocalDateTime` 约定，是"本地事务 + 同步调用 + 幂等键 + 人工重试"跨服务一致性方案（ADR-009 方案 A）的完整落地。
