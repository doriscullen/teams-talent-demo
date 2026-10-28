# 数据字典

> 生成能力：文档业务知识提取 · 来源：设计文档（版本 10-27 09:05）、carddemo-java-1025 领域模型 · 生成时间：2026-10-27 09:31
> 覆盖与返现相关的 6 个实体、代码集与标识符规则。字段名沿用代码仓的表字段，文档口径与代码不一致处单独列出。

## 1. 实体总览

| 实体 | 所属服务 / 表 | 主键 | 唯一约束 |
|---|---|---|---|
| Campaign 营销活动 | marketing-service / `campaign` | `campaign_id` | — |
| Enrollment 报名 | marketing-service / `enrollment` | `enrollment_id` | `uk_enrollment_campaign_card (campaign_id, card_number)` |
| RewardGrant 奖励记录 | marketing-service / `reward_grant` | `reward_id` | `uk_reward_campaign_txn (campaign_id, transaction_id)` |
| AccountSnapshot 账户快照 | marketing-service 只读，不落库 | `accountId` | — |
| Account 账户 | account-service / `account` | `account_id` | — |
| RewardCredit 返现入账记录 | account-service / `reward_credit` | `reward_id` | 主键即幂等键 |

来源：carddemo-java-1025 / services/marketing-service/src/main/resources/db/migration/V1__marketing_schema.sql；services/account-service/src/main/resources/db/migration/V3__reward_credit.sql

## 2. 关键字段

### 营销活动（Campaign）

| 字段 | 含义 | 类型 | 取值 / 说明 |
|---|---|---|---|
| campaign_id | 活动号 | VARCHAR(36) | UUID |
| campaign_type | 活动类型 | VARCHAR(32) | 见 §3 `CampaignType` |
| status | 活动状态 | VARCHAR(16) | 见 §3 `CampaignStatus` |
| start_at / end_at | 起止时间 | TIMESTAMP | 判定区间 `[start_at, end_at)`；`LocalDateTime`，不带时区 |
| target_group_id | 目标账户组 | VARCHAR(10) | 空表示不限；**不是**卡片等级 |
| category_code | 交易类别 | VARCHAR(4) | 4 位数字，空表示不限 |
| reward_rate | 返现比例 | NUMERIC(6,4) | 0.5% 记为 `0.0050` |
| fixed_reward_amount | 固定返现额 | NUMERIC(12,2) | 大于 0 时优先于比例 |
| max_reward_per_transaction | 单笔返现上限 | NUMERIC(12,2) | 空表示不封顶 |
| budget / consumed_amount | 预算 / 已消耗 | NUMERIC(12,2) | 比例返现活动要求预算 > 0 |
| enrollment_required | 是否需报名 | BOOLEAN | 本次需求为 `false` |
| version | 乐观锁版本 | BIGINT | `@Version` |

### 奖励记录（RewardGrant）

| 字段 | 含义 | 类型 | 取值 / 说明 |
|---|---|---|---|
| reward_id | 奖励号 | VARCHAR(36) | UUID，同时是返现入账的幂等键 |
| campaign_id / transaction_id | 活动号 / 交易号 | VARCHAR(36) / VARCHAR(16) | 联合唯一，同一活动同一交易只发一次 |
| card_number / account_id / customer_id | 卡号 / 账户号 / 客户号 | VARCHAR(16) / (11) / (9) | 零填充字符串 |
| reward_type | 奖励类型 | VARCHAR(16) | `CASHBACK` / `POINTS` |
| reward_amount | 返现金额 | NUMERIC(12,2) | 必须 > 0，否则抛 `REWARD_ZERO` |
| status | 奖励状态 | VARCHAR(16) | `PENDING` / `GRANTED` / `FAILED` |
| failure_reason | 失败原因 | VARCHAR(200) | 入账失败时记录 |

### 账户与返现入账（Account / AccountSnapshot / RewardCredit）

| 字段 | 含义 | 类型 | 取值 / 说明 |
|---|---|---|---|
| account.current_balance | **欠款** | NUMERIC(12,2) | 消费增加，返现冲减；可为负（溢缴） |
| account.active_status | 账户状态 | VARCHAR(1) | `Y` 有效，其他值不参与活动 |
| account.group_id | 账户组 | VARCHAR(10) | 资格判定用于匹配 `target_group_id` |
| reward_credit.reward_id | 奖励号 | VARCHAR(36) | 主键；重复调用不再冲减欠款 |
| reward_credit.amount | 入账金额 | NUMERIC(12,2) | 必须 > 0，否则抛 `INVALID_CASHBACK_AMOUNT` |

`AccountSnapshot` 只含 `accountId`、`activeStatus`、`currentBalance`、`groupId` 四个字段，营销服务拿不到卡片等级。

来源：carddemo-java-1025 / services/marketing-service/.../domain/model/Campaign.java、RewardGrant.java、AccountSnapshot.java；services/account-service/.../domain/model/Account.java、RewardCredit.java

## 3. 代码集

**活动类型 `CampaignType`**：`FIRST_PURCHASE_CASHBACK` 首笔固定返现 · `CATEGORY_CASHBACK` 类别比例 / 固定返现 · `POINTS_MULTIPLIER` 积分倍数

**活动状态 `CampaignStatus`**：`DRAFT` → `ACTIVE` ⇄ `PAUSED` → `ENDED`（终态）；只有 `DRAFT` 可编辑规则

**奖励状态 `RewardStatus`**：`PENDING` 待入账（可经 `fulfill` 重试）· `GRANTED` 已发放 · `FAILED` 失败

**资格判定原因码**（`EligibilityPolicy`，按判定顺序）：

| 原因码 | 含义 |
|---|---|
| `CAMPAIGN_NOT_ACTIVE` | 活动未生效或不在期间内 |
| `ACCOUNT_NOT_FOUND` / `ACCOUNT_INACTIVE` | 账户不存在 / 账户状态不是 `Y` |
| `ACCOUNT_GROUP_MISMATCH` | 账户组不匹配 |
| `CATEGORY_MISMATCH` / `AMOUNT_TOO_LOW` | 交易类别不匹配 / 低于最低金额 |
| `NOT_ENROLLED` | 需报名但未报名 |
| `CARD_LIMIT_REACHED` / `FIRST_PURCHASE_ALREADY_REWARDED` | 每卡次数已满 / 首刷已奖励 |
| `REWARD_ZERO` / `BUDGET_EXHAUSTED` | 奖励为 0 / 预算不足 |
| `ALREADY_EVALUATED` | 同一活动同一交易已评估（`RewardEvaluationService`） |

现有原因码中没有“卡片等级不符”。

来源：carddemo-java-1025 / services/marketing-service/.../domain/model/CampaignType.java、CampaignStatus.java、RewardStatus.java；domain/service/EligibilityPolicy.java

## 4. 标识符与金额规则

| 标识符 / 金额 | 规则 |
|---|---|
| 交易号 | 16 位字符型 |
| 卡号 | 16 位数字字符串，评估入口校验 `\d{16}` |
| 账户号 | 11 位数字字符串，评估入口校验 `\d{11}` |
| 活动号 / 奖励号 | 36 位 UUID |
| 金额 | `BigDecimal` / `NUMERIC(12,2)`，以元为单位，不用 `double` |

来源：carddemo-java-1025 / docs/design/adr/ADR-002-identifier-and-money-modeling.md；services/marketing-service/.../application/RewardEvaluationService.java

## 5. 文档口径与代码字段对照

| 文档口径 | 代码字段 | 差异 |
|---|---|---|
| 白金卡 / 普通卡 | 无 | 卡片等级字段待实现 |
| 金额以整数分计算 | `amount`（`BigDecimal` 元，两位小数） | 舍入结果一致，单位不同 |
| 期间按消费时间判定，结束不包含 | `start_at` / `end_at`；判定取评估时刻 | 评估命令中的 `processedAt` 未参与判定 |
| 额外返现 0.5% | `reward_rate = 0.0050` | 代码仓未配置该活动 |

来源：设计文档 / cashback-contract.md 第 6–9 行；carddemo-java-1025 / services/marketing-service/.../application/EvaluationCommand.java
