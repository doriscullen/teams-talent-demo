# 活动资格判定与有效期控制 代码分析报告

> 需求：实现营销活动资格校验与有效期控制，包含活动状态、时间窗口、账户状态、目标账户组、报名及参与限制。
> 代码片段：`01-campaign-policy.patch`（Campaign 聚合根、CampaignDraft、CampaignStatus、AccountSnapshot、EligibilityPolicy）、`02-tests.patch`（CampaignTest、EligibilityPolicyTest）。

## 一、仓库知识层次分类

需求位于 `carddemo-java-1025` 微服务体系的 **Marketing（营销）支撑域**，落在 `marketing-service`（端口 8087）的 DDD 分层中：

```
carddemo-java-1025 微服务架构
└── Marketing 支撑域（marketing-service :8087，库 carddemo_marketing）
    ├── domain/model（领域模型）        ← 本次主要改动：Campaign（聚合根）、CampaignDraft、CampaignStatus、AccountSnapshot
    ├── domain/service（领域服务）      ← 本次主要改动：EligibilityPolicy（资格判定）
    ├── domain/repository（仓储端口）    ← CampaignRepository.findActiveAt 被判定链调用（本仓既有）
    ├── application（应用服务）          ← RewardEvaluationService / MarketingQueryService 调用判定链（本仓既有）
    ├── interfaces/rest（入站适配器）    ← CampaignController、MarketingController 暴露状态迁移与活动中心（本仓既有）
    └── infrastructure/client（出站适配器）← AccountClient 获取账户快照（本仓既有）
```

依据 `docs/design/08-marketing-capability.md`：存量 CardDemo 原本没有任何营销能力，本次是**新增支撑域**。资格判定是营销能力的核心领域逻辑，被两个业务入口复用：活动中心（展示"能否参与"）与交易后奖励评估（完整资格 + 计价）。

## 二、需求影响位置依赖分析

### 2.1 片段内依赖（本次新增代码之间）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `EligibilityPolicy` → `Campaign` | 调用 | `EligibilityPolicy.java:478-489`（`evaluateParticipation` 调 `campaign.isActiveAt()`、`matchesGroup()`、`isEnrollmentRequired()`）；`:503-528`（`evaluateTransaction` 调 `matchesCategory()`、`getMinTransactionAmount()`、`getMaxRewardsPerCard()`、`getCampaignType()`、`hasBudgetFor()`） |
| `EligibilityPolicy` → `AccountSnapshot` | 调用 | `:484`（`account.activeStatus()`、`account.groupId()`） |
| `EligibilityPolicy` → `RewardComputation` / `RewardCalculator` | 调用 | `:521-522`（`RewardCalculator.compute()` 计算奖励，`RewardComputation` 承载结果） |
| `Campaign` → `CampaignDraft` | 调用 | `Campaign.java:130-151`（`applyDraft` 读取 draft 字段）、`:234-292`（`validate` 静态校验） |
| `Campaign` → `CampaignStatus` / `CampaignType` | 枚举使用 | 状态机与类型分支（`:131`、`:154`、`:263-290`） |
| `Campaign` → `BusinessRuleException` | 依赖 | 业务断言统一抛领域异常（`:132`、`:155-163` 等） |
| 测试 → 领域类 | 调用 | `CampaignTest` / `EligibilityPolicyTest` 构造实体、调用状态迁移与判定 |

### 2.2 与代码仓既有代码的依赖（片段未含，需结合仓上下文）

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `EligibilityPolicy` ← `RewardEvaluationService`（application） | 调用 | 交易后评估：`RewardEvaluationService.java:74-76` 调 `evaluateTransaction`，`:78-80` 取 `evaluation.reason()` 记录跳过原因 |
| `EligibilityPolicy` ← `MarketingQueryService`（application） | 调用 | 活动中心：`MarketingQueryService.java:54-56` 调 `evaluateParticipation`，展示 `eligible`/`reason` |
| `AccountSnapshot` ← `AccountClient`（infrastructure） | 数据来源 | `AccountClient.java:28-46` 调 account-service 读账户快照，404 转 `Optional.empty()`，`:60-63` 私有 record 转换 |
| `Campaign.isActiveAt` ← `CampaignRepository.findActiveAt` | 查询配合 | `CampaignJpaRepository.java:39-42` 以 `status=ACTIVE && startAt<=now && endAt>now` 派生查询预筛 |
| `Campaign` ← `CampaignApplicationService` / `EnrollmentApplicationService` | 调用 | `CampaignApplicationService.java:81-97` 状态迁移（activate/pause/end）；`EnrollmentApplicationService.java:41-43` 报名仅 ACTIVE |
| `RewardCalculator`（本仓既有，片段中仅被引用） | 调用 | `RewardCalculator.java:18-39` 现金返现（固定额优先/比例 HALF_UP/单笔封顶）与积分（floor）计价 |
| `RewardGrant`（本仓既有） | 数据 | 判定链中的 `rewardsOnCard`、`BUDGET_EXHAUSTED` 语义与 `RewardGrant` 状态机配套（`RewardGrant.java:75-109`） |

## 三、调用跟踪

### 3.1 活动中心（展示"能否参与"）

```
GET /api/v1/eligibilities?cardNumber=&accountId=
  └─ MarketingController.offers()
       └─ MarketingQueryService.offers()（@Transactional(readOnly=true)）
            ├─ accountClient.findAccount(accountId) → AccountSnapshot（404 → ACCOUNT_NOT_FOUND 抛异常）
            ├─ campaigns.findActiveAt(now) → List<Campaign>（SQL 预筛状态+时间窗）
            └─ 对每个 Campaign：
                 enrollments.findEnrollment(campaignId, cardNumber) → 是否已报名
                 EligibilityPolicy.evaluateParticipation(campaign, account, enrolled, now)
                     ├─ campaign.isActiveAt(now)：status==ACTIVE && [startAt, endAt)
                     ├─ account.activeStatus()=="Y"
                     ├─ campaign.matchesGroup(account.groupId())：targetGroupId 为空或相等
                     └─ 需报名时 enrolled==true
                 产出 Evaluation(eligible, reason) → OfferResponse（含原因码文案）
```

### 3.2 交易后奖励评估（完整资格 + 计价）

```
POST /api/v1/reward-evaluations（transaction-service 入账后调用）
  └─ RewardEvaluationService.evaluate()（@Transactional(noRollbackFor=RemoteServiceException)）
       ├─ 参数校验（validate：交易号/卡号 16 位/账户 11 位/金额>0）
       ├─ accountClient.findAccount(...)（不存在 → skipped ACCOUNT_NOT_FOUND）
       ├─ 幂等检查 rewards.existsByCampaignAndTransaction（命中 → skipped ALREADY_EVALUATED）
       └─ 对 campaigns.findActiveAt(now) 中每个活动：
            ├─ enrolled = enrollments.findEnrollment(...) 是否已报名
            ├─ rewardsOnCard = rewards.countByCampaignAndCard(...)
            ├─ EligibilityPolicy.evaluateTransaction(campaign, account, amount, category, enrolled, rewardsOnCard, now)
            │    ├─ evaluateParticipation(...)（活动时间窗/账户状态/账户组/报名）
            │    ├─ campaign.matchesCategory(categoryCode)
            │    ├─ amount >= minTransactionAmount
            │    ├─ rewardsOnCard < maxRewardsPerCard
            │    ├─ FIRST_PURCHASE_CASHBACK 要求 rewardsOnCard==0（未奖励过）
            │    ├─ RewardCalculator.compute(campaign, amount) → RewardComputation
            │    ├─ 奖励 > 0（否则 REWARD_ZERO）
            │    └─ campaign.hasBudgetFor(reward.amount())（否则 BUDGET_EXHAUSTED）
            ├─ 不满足 → skipped(reason) 继续下一活动
            ├─ 满足 → campaign.consumeCashback(amount) 扣预算 → 建 RewardGrant → 调账户入账/转 PENDING
```

### 3.3 活动生命周期（状态机控制有效期）

```
POST /api/v1/campaigns/{id}/activate|pause|end
  └─ CampaignController → CampaignApplicationService.activate/pause/end
       └─ campaign.activate(now)：
            ├─ 前置状态：DRAFT 或 PAUSED
            ├─ now.isBefore(endAt)（未过期）
            ├─ CATEGORY_CASHBACK 需 budget>0
            └─ status = ACTIVE
```

## 四、需求分类

这是一个**新特性开发（支撑域新增）**需求：在无营销能力的存量卡系统上，从零建设"营销活动资格校验与有效期控制"领域能力。属于领域建模 + 业务规则引擎类需求，核心产出是**领域聚合根状态机**与**无状态资格判定策略**，而非单纯的 CRUD。

## 五、示例使用上下文

- **活动中心页**（`MarketingQueryService.offers`）：持卡人查看"我能参与哪些活动、为什么不能"，用 `evaluateParticipation` 输出原因码给前端展示文案。这是营销功能对用户的入口，直接决定用户体验（原因码要可读、可解释）。
- **交易入账后奖励评估**（`RewardEvaluationService.evaluate`）：消费事实成立后，对所有当前 ACTIVE 活动逐一判定并发放奖励。判定链在此是**发放决策的过滤器**，命中即不发。
- **活动管理后台**（`CampaignController`）：管理员创建草稿、编辑、发布/暂停/结束活动；`Campaign.activate/pause/end` 是"有效期控制"的操作面——**状态机 + 时间窗是资格判定的两个时间维度**：状态是人为开关，时间窗是自然边界，`isActiveAt` 把两者合成一个判定。

## 六、具体根因分析（如何）

1. **为什么要新增 `Campaign` 聚合根**：资格判定的前提是"活动的规则与状态"必须有一处权威来源。把规则字段、状态机、预算不变量全部封装在聚合根内，保证任何入口（管理端迁移、交易评估扣预算）都经过同一套不变量校验，避免规则散落在 Service 中。`docs/design/08-marketing-capability.md` §2.1 明确定义了聚合与不变量（名称 ≤80、`startAt < endAt`、类型与计价字段匹配、状态迁移合法、`consumedAmount ≤ budget`）。
2. **为什么要单独的 `EligibilityPolicy` 领域服务**：资格判定是被两个不同上下文（活动中心查询、交易评估）复用的纯逻辑。做成无 Spring 依赖的静态策略类，一是便于纯 JUnit 测试（无需容器），二是判定顺序与需求文档 MK-ELI 一一对应，集中维护可保证两个入口语义一致。
3. **为什么判定顺序即优先级**：需求明确"命中第一个不满足条件即返回原因码"（`docs/design/08` §2.3）。顺序不是随意的：先活动（营销可控）→ 再账户（客户侧）→ 再交易（本次行为），把成本最低/最稳定的判断前置。
4. **为什么 `AccountSnapshot` 是 record 且不落库**：账户状态、账户组属于 Account 域的**读模型**。Marketing 是支撑域，遵循 ADR-003 数据所有权——不复制账户数据，只做只读快照传输对象，通过 `AccountClient` 实时获取，保证判定时账户状态不过期。
5. **环境约束**：JDK 21、Spring Boot 3.3.6、JPA + H2/PostgreSQL、JUnit 5 + AssertJ。`@Version` 乐观锁用于预算并发（`docs/design/08` §8 风险项：极端并发可能超发 1 笔）。遗留标识统一零填充定长字符串（`07-java-conventions.md` §3），所以 `AccountSnapshot.accountId` 是 String。

## 七、当前与预期行为

- **需求实现前**：代码仓无营销能力，不存在活动概念，自然也没有资格校验——交易入账后没有任何奖励逻辑（`docs/design/08`：新增支撑域，非遗留迁移项）。
- **需求实现后**：
  - 活动有了显式生命周期：`DRAFT → ACTIVE ⇄ PAUSED → ENDED`，只有 ACTIVE 且在时间窗内的活动才"有效"（`Campaign.isActiveAt`，`01-campaign-policy.patch:185-189`）。
  - 有了统一的资格判定链：活动有效性 → 账户存在/状态 → 账户组 → 类别 → 金额 → 报名 → 每卡次数 → 首刷唯一性 → 预算 → 奖励非零，失败即返回原因码。
  - 活动中心与交易评估两个入口通过同一策略类获得一致语义（`EligibilityPolicy.java:476-528`）。
- **容易被忽略的独特方面**：
  - **状态与时间窗是两把锁**：`activate` 只校验"未过期"，`isActiveAt` 才同时校验状态与时间窗；已过期的活动即使误置 ACTIVE 也不会发放（双保险）。
  - **空值语义**：`targetGroupId`/`categoryCode` 为 null 表示"不限制"（`matchesGroup`/`matchesCategory` 空值即通过），这是目标账户组/类别限制的"通配"设计。
  - **`remainingBudget()` 对预算为 0 返回 null**（`Campaign.java:227-232`）：积分活动无预算概念，返回 null 表示"无预算约束"而非"预算为 0 不可发"——避免与"预算耗尽"混淆。
  - **判定与扣减分离**：`hasBudgetFor`（判定）与 `consumeCashback`（扣减）成对出现但分离，`consumeCashback` 内部再校验一次（`Campaign.java:216-225`），防止判定与扣减之间状态变化（乐观锁兜底并发）。

## 八、需求实现逻辑（如何/为什么）

### 8.1 新增文件

| 文件（patch 内） | 责任 | 关键点 |
|---|---|---|
| `domain/model/AccountSnapshot.java` | 账户只读快照 | record，4 个字段（accountId/activeStatus/currentBalance/groupId），注释声明"营销只读，不保存"——数据所有权边界的显式表达 |
| `domain/model/CampaignStatus.java` | 活动状态枚举 | `DRAFT/ACTIVE/PAUSED/ENDED`，用 `@Enumerated(EnumType.STRING)` 落库（`Campaign.java:61-63`），避免枚举序数漂移 |
| `domain/model/CampaignDraft.java` | 规则草案（CQ 分离） | 15 字段的 record，一次性传递所有可编辑规则；新建与编辑共用（`applyDraft`） |
| `domain/model/Campaign.java` | 聚合根 | 状态机方法（activate/pause/end）、判定方法（isActiveAt/matchesGroup/matchesCategory/hasBudgetFor）、预算消耗（consumeCashback/remainingBudget）、规则校验（validate）、JPA 映射（@Version 乐观锁） |
| `domain/service/EligibilityPolicy.java` | 资格判定策略 | 常量原因码、`Evaluation` record、`evaluateParticipation`/`evaluateTransaction` 两个入口 |

### 8.2 为什么这样设计

- **聚合根承载状态机（充血模型）**：符合 `07-java-conventions.md` §3"领域行为写在实体上"。状态迁移方法各自校验前置状态与约束（`activate` 校验 DRAFT/PAUSED + 未过期 + 现金返现需预算；`pause` 仅 ACTIVE；`end` 仅 ACTIVE/PAUSED），非法迁移抛 `BusinessRuleException`（409 语义，`GlobalExceptionHandler` 统一转译）。
- **校验方法共用**：`applyDraft` 在新建（构造器）与编辑两条路径上共用同一 `validate(draft)`（`Campaign.java:118-151`），按 `campaignType` 分支校验计价字段自洽性（`switch` 表达式，`:263-290`）。避免"新建合法、编辑绕过校验"的经典漏洞。
- **判定与执行分离、结果对象化**：`EligibilityPolicy` 不抛异常表达"不合格"，而是返回 `Evaluation(eligible, reason, reward)` record——因为"不合格"是业务常态（用户看活动中心、交易批量评估跳过），不是异常；只有"计算奖励为零/预算不够"这类内部状态也走 reason 码，保持调用方处理路径统一。这与 `RewardGrant` 构造器抛 `REWARD_ZERO`（唯一性校验）形成对照：**领域服务判定用返回值，实体不变量用异常**。
- **两个判定入口的粒度差异**：`evaluateParticipation`（活动中心用）只判"能否参与"，不涉交易金额/类别/次数；`evaluateTransaction`（交易后用）先复用 participation 再叠加交易级判定——**公共逻辑下沉、差异化叠加**，避免两处逻辑漂移。
- **常量集中定义原因码**：11 个原因码常量（`EligibilityPolicy.java:447-457`），与测试断言、`RewardEvaluationService` 的 skipped 记录、前端文案共用同一符号，避免魔法字符串散落。

### 8.3 非代码配置

本片段不含迁移脚本（`V1__marketing_schema.sql` 等为本仓既有，`campaign` 表由既有迁移建立）。规则出处是 `docs/design/08-marketing-capability.md`（MK-ELI-01..09），代码注释中保留了需求编号（如 `Campaign.java:204` 的 MK-ELI-09、`Campaign.java:127` 的 MK-CAM-01..06）——**需求可追溯性通过注释编号维持**，这是本仓的既有约定。

## 九、具体实现步骤

1. **定义状态枚举与规则草案 record**
   - 建立 `CampaignStatus`（4 态）与 `CampaignDraft`（15 字段规则草案）。
   - 要点：状态用 `EnumType.STRING` 落库；草案用不可变 record，一次性承载全部可编辑规则，新建/编辑共用。
   - 目的：让"活动的规则与状态"有类型安全、不可变的传输载体。

2. **实现 `Campaign` 聚合根：规则字段 + JPA 映射**
   - 字段与 `@Column` 一一对应，金额 `BigDecimal(precision=12, scale=2)`（禁止 double），时间 `LocalDateTime`，带 `@Version` 乐观锁。
   - 提供 protected 无参构造（JPA 专用）与业务构造器（`campaignId, draft, now`，初始 `DRAFT` + `consumedAmount=0`）。
   - 要点：`now` 由调用方传入而非内部 `LocalDateTime.now()`，保证测试可控与语义统一（`updatedAt` 一致性）。

3. **实现规则校验 `validate(draft)` 与编辑 `applyDraft`**
   - 通用校验：名称非空 ≤80、类型必填、`startAt < endAt`、最低金额/预算非负、类别码 `\d{4}`、每卡次数 >0。
   - 按 `campaignType` 分支校验：首刷需 `fixedRewardAmount > 0`；类别返现需"比例或固定额至少其一"、比例 ≤100%、预算 >0；积分需 `pointsMultiplier > 0`。
   - `applyDraft` 仅 DRAFT 可编辑，字段 trim/blankToNull 归一化后写入，统一更新 `updatedAt`。
   - 目的：把"活动是否可发布"的全部约束收敛到聚合根一处，任何入口（新建/编辑）都强制经过。

4. **实现状态机方法（有效期控制的操作面）**
   - `activate(now)`：仅 DRAFT/PAUSED；`now < endAt` 未过期；现金返现类预算 >0。
   - `pause(now)`：仅 ACTIVE；`end(now)`：仅 ACTIVE/PAUSED（ENDED 为终态）。
   - 非法迁移统一抛 `BusinessRuleException("INVALID_CAMPAIGN_STATE", ...)`。
   - 要点：**状态机负责"开关"，时间窗负责"自然边界"，二者独立校验**。

5. **实现判定查询方法（有效期控制的判定面）**
   - `isActiveAt(moment)`：`status==ACTIVE && !moment.isBefore(startAt) && moment.isBefore(endAt)`（左闭右开）。
   - `matchesGroup(groupId)`/`matchesCategory(category)`：目标为空即通配（null 语义）。
   - `hasBudgetFor(amount)`：现金返现才判定，`consumedAmount + amount <= budget`；`remainingBudget()` 预算为 0 返回 null 表示无约束。
   - 目的：把"活动当前是否有效、是否命中目标"封装成可单测的纯领域方法。

6. **实现 `EligibilityPolicy` 资格判定策略（核心）**
   - 定义 11 个原因码常量 + `Evaluation(eligible, reason, reward)` record（含 `eligible(reward)`/`rejected(reason)` 工厂）。
   - `evaluateParticipation(campaign, account, enrolled, now)`：活动有效 → 账户存在 → 账户状态 Y → 账户组匹配 → 需报名时已报名。
   - `evaluateTransaction(campaign, account, amount, category, enrolled, rewardsOnCard, now)`：复用 participation → 类别匹配 → 金额 ≥ 最低 → 每卡次数未达上限 → 首刷类无历史奖励 → 计算奖励（`RewardCalculator.compute`）→ 奖励非零 → 预算充足。
   - 要点：**顺序即原因码优先级**，命中第一个不满足即返回；判定链中的 `rewardsOnCard`/`enrolled` 由调用方（应用服务）从仓储统计后传入——策略保持无状态、无 IO。

7. **编写领域单测覆盖状态机与判定分支**
   - `CampaignTest`：构造 → DRAFT 初始态与预算；`activate → consumeCashback` 消耗；超预算抛 `BUDGET_EXHAUSTED`；状态机非法迁移（DRAFT 不可 pause、ACTIVE 不可再 activate、ENDED 不可再 activate）；ACTIVE 不可编辑（`CAMPAIGN_NOT_EDITABLE`）；非法时段/缺奖励/现金返现无预算的规则校验。
   - `EligibilityPolicyTest`：全部条件满足得奖励；每个拒绝分支（NOT_ACTIVE/ACCOUNT_INACTIVE/GROUP_MISMATCH/CATEGORY_MISMATCH/AMOUNT_TOO_LOW/NOT_ENROLLED/CARD_LIMIT_REACHED/ALREADY_REWARDED/BUDGET_EXHAUSTED）逐一断言原因码。
   - 断言方式：`assertThatThrownBy(...).extracting("code").isEqualTo("...")` 断言错误码而非 message；金额断言 `isEqualByComparingTo`（BigDecimal 等值）。
   - 目的：把需求文档 MK-ELI-01..09 的每条规则变成可执行断言，作为回归基线。

## 十、需求实施检查清单

- [ ] **状态机完整性**：每个状态迁移方法都校验前置状态；ENDED 为终态；非法迁移抛 `INVALID_CAMPAIGN_STATE`。测试必须覆盖非法迁移（如 ACTIVE 再 activate）。
- [ ] **时间窗左闭右开**：`isActiveAt` 用 `!moment.isBefore(startAt) && moment.isBefore(endAt)`；`activate` 用 `now.isBefore(endAt)` 判断未过期。注意 `LocalDateTime` 比较用 `isBefore/isAfter`，不要转字符串。
- [ ] **金额比较**：一律 `BigDecimal.compareTo/signum`，禁止 `double`/`==`；奖励率 ≤1（100%）用 `compareTo(ONE) > 0` 判断。
- [ ] **空值即通配**：`targetGroupId`/`categoryCode` 为空表示不限，判定方法必须显式处理 null（`targetGroupId == null || Objects.equals(...)`）。
- [ ] **类型分支自洽**：每种 `CampaignType` 的计价字段组合都有校验（首刷→固定额、类别返现→比例或固定额+预算、积分→倍数）；switch 必须有 `default` 分支。
- [ ] **判定与扣减分离**：`hasBudgetFor` 判定后再 `consumeCashback` 内部二次校验；并发预算靠 `@Version` 兜底，极端并发可能超发 1 笔（设计文档 §8 风险，需对账）。
- [ ] **`now` 统一入参**：聚合根方法的时间全部由调用方传入（应用层 `LocalDateTime.now(clock)`），`consumeCashback` 是唯一例外（本仓现状），新增代码不要混用 `LocalDateTime.now()`。
- [ ] **原因码常量化**：判定失败原因用 `EligibilityPolicy` 常量，测试断言同一符号；前端文案与原因码映射需配套。
- [ ] **识别标识**：账户 11 位、卡号 16 位零填充字符串，判定/查询参数按此校验（`\d{11}`/`\d{16}`）。
- [ ] **需求编号注释**：规则实现处保留 MK-ELI/MK-CAM 需求编号，与 `docs/design/08-marketing-capability.md` 对应，保证可追溯。
- [ ] **两个入口语义一致**：若新增判定维度，同时更新 `evaluateParticipation` 与 `evaluateTransaction`（后者复用前者），并补测试。

## 十一、总结

这是**营销支撑域（marketing-service）新增的"活动资格判定与有效期控制"能力**。需求以 DDD 分层落地：`Campaign` 聚合根（`domain/model/Campaign.java`）以状态机 `DRAFT → ACTIVE ⇄ PAUSED → ENDED` + 时间窗 `[startAt, endAt)` 承载**有效期控制**（操作面 `activate/pause/end`，判定面 `isActiveAt`），并以类型分支校验（`validate`）与预算不变量（`hasBudgetFor`/`consumeCashback`）约束规则自洽；`EligibilityPolicy` 领域服务（`domain/service/EligibilityPolicy.java`）以**顺序即优先级**的判定链承载**资格校验**（活动有效 → 账户状态 → 账户组 → 类别 → 金额 → 报名 → 次数/首刷 → 预算 → 奖励非零），通过 `Evaluation(eligible, reason, reward)` record 返回结果而不抛异常；`AccountSnapshot` 作为 Account 域的只读快照传输对象维持数据所有权边界。判定逻辑被活动中心（`evaluateParticipation`，`MarketingQueryService`）与交易后奖励评估（`evaluateTransaction`，`RewardEvaluationService`）两个入口复用，公共判定下沉、交易级判定叠加，保证语义一致。`CampaignTest` 与 `EligibilityPolicyTest` 将 MK-CAM/MK-ELI 的每条规则固化为可执行断言。整体遵循本仓基线（`docs/design/07-java-conventions.md`）：充血模型、领域异常 `BusinessRuleException("CODE", msg)`、`BigDecimal` 金额、零填充标识、`@Version` 乐观锁、需求编号注释追溯。
