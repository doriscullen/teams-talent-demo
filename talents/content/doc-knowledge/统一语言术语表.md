# 统一语言术语表

> 生成能力：文档业务知识提取 · 来源：设计文档（版本 10-27 09:05） · 生成时间：2026-10-27 09:31
> 收录 16 个核心术语与 8 组易混淆概念。编写代码、接口和文档时请使用“中文”列的叫法。

## 1. 核心术语

| 英文 | 中文 | 定义 | 代码对应（carddemo-java-1025） |
|---|---|---|---|
| Platinum Card | 白金卡 | 本次额外返现的适用卡片等级 | 无（卡等级字段待实现） |
| Standard Card | 普通卡 | 白金卡以外的卡片，不适用本次额外返现 | 无 |
| Extra Cashback | 额外返现 | 白金卡消费在期间内额外获得的返现，比例 0.5%（1/200） | `RewardComputation.cashback()` |
| Campaign Window | 消费期间 | 返现适用的时间段，开始时刻包含、结束时刻不包含 | `Campaign.startAt` / `endAt` |
| Integer Cents | 整数分 | 金额计算单位；奖励先按分计算，半分向上舍入至整分 | 无（代码以 `BigDecimal` 元计算） |
| Purchase | 消费 | 一笔已入账的消费交易，入账后触发奖励评估 | `PostingCommand` / `TransactionRecord` |
| Reward Evaluation | 奖励评估 | 消费入账后判定资格并计算奖励 | `RewardEvaluationService.evaluate()` |
| Reward Grant | 奖励记录 | 一个活动对一笔交易的奖励结果，含状态 | `RewardGrant` / `reward_grant` |
| Cashback Credit | 返现入账 | 把返现金额冲减账户欠款 | `Account.applyCashback()` / `reward_credit` |
| Current Balance | 欠款 | 账户已用额度；消费增加欠款，返现减少欠款 | `Account.currentBalance` |
| Idempotency Key | 幂等键 | 重复处理时识别同一操作的标识 | `(campaign_id, transaction_id)`、`reward_id` |
| Pending | 待完成 | 返现入账失败后保留的可重试状态 | `RewardStatus.PENDING` |
| Manual Retry | 人工重试 | 对待完成奖励再次发起返现入账，沿用同一奖励号 | `POST /api/v1/rewards/{rewardId}/fulfill` |
| Marketing Switch | 营销开关 | 关闭后入账不再调用奖励评估，用于回退 | `marketing.enabled` |
| Access Token | 访问令牌 | iam-service 签发的 HMAC 签名令牌，含用户号、用户类型和过期时间 | `HmacTokenService` |
| User Type | 用户类型 | `A` 管理员 / 其他按普通用户，只决定登录后进入的菜单 | `User.landingMenu()` |

来源：设计文档 / cashback-contract.md 第 3–10 行；ADR-009-marketing-integration.md「决策」1–5、「后果」；ADR-007-authentication-scope.md「决策」

## 2. 易混淆概念

| 术语 / 字段 | 常见误读 | 正确语义 |
|---|---|---|
| 白金卡客户 | 等同于账户组 `groupId` | 文档按卡片等级界定；现有 `EligibilityPolicy` 只按账户组判断，两者的对应关系未定义 |
| 消费期间结束时刻 | 2027-02-01 00:00:00 当天仍可返现 | 结束时刻**不包含**；该时刻及之后的消费不返现 |
| 期间判定时刻 | 按消费发生时间判定 | 文档按消费时间界定；代码按评估时的系统时间判定，两者在跨期边界处可能不一致 |
| 0.5% 返现 | 按元计算后四舍五入 | 按**整数分**计算，额外返现 = 消费金额 × 1/200，半分向上舍入至整分 |
| 返现与欠款 | 返现增加账户余额 | `currentBalance` 是欠款，返现**冲减**欠款；120.00 元消费后欠款 2550.75 → 2670.15 元 |
| 重复评估与重复入账 | 去重只做一次即可 | 两层幂等：评估按 `(campaign_id, transaction_id)` 去重，返现入账按 `reward_id` 去重，重试时两层都要命中 |
| 评估失败与入账结果 | 奖励评估失败会回滚交易 | 营销是附加权益，评估失败只告警，交易照常入账 |
| 携带 token 与已鉴权 | 请求带了 token 就已通过校验 | 资源服务本期**不校验** token，只有 iam-service 的 verify 接口校验；生产化前须接入网关 |

来源：设计文档 / cashback-contract.md 第 6–9 行；ADR-009-marketing-integration.md「决策」1–3；ADR-007-authentication-scope.md「决策」

## 3. 命名速查

| 前缀 | 含义 |
|---|---|
| `BR-CASH-*` | 白金卡额外返现规则（本知识） |
| `BR-POST-*` | 营销奖励与入账集成规则（本知识） |
| `BR-SEC-*` | 鉴权范围规则（本知识） |
| `MK-ELI-*` | 代码仓中的资格判定规则编号，见 `EligibilityPolicy` |
| `MK-REW-*` | 代码仓中的奖励评估与发放规则编号，见 `RewardEvaluationService` |
| `NR-REWARD-01` | 代码仓中的返现入账幂等规则，见 `Account.applyCashback()`、`RewardCredit` |

来源：carddemo-java-1025 / services/marketing-service、services/account-service 源码注释

## 4. 待业务确认

- 白金卡身份的数据来源（卡片等级字段，或账户组映射）。
- 正式活动起止日期与舍入方式（当前为本地流程参数）。
- 消费类别、门槛、封顶与退款规则。
- 额外返现与已有活动奖励的叠加方式。

来源：设计文档 / cashback-contract.md 第 5、10 行
