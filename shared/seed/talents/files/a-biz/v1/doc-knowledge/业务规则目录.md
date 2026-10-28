# 业务规则目录

> 生成能力：文档业务知识提取 · 来源：设计文档（版本 10-26 10:00） · 生成时间：2026-10-26 11:06
> 共提取 16 条规则：已实现 7 · 部分 6 · 待实现 3。`BR-POST-*` 为营销奖励与入账集成，`BR-SEC-*` 为鉴权范围。落点指代码仓 carddemo-java-1025 中的位置。

**状态说明**：`已实现` 代码仓中有对应代码且语义一致；`部分` 有可复用机制，但口径与文档不同；`待实现` 代码仓中没有对应落点；`待确认` 文档列为未定事项，不能据此实现。

## 1. 营销奖励与入账集成（transaction-service + marketing-service + account-service）

| 规则 | 内容 | 落点 | 状态 |
|---|---|---|---|
| BR-POST-01 | 营销不阻塞账务：入账本地事务先提交，再调用 `POST /api/v1/reward-evaluations` | `PostingService.evaluateRewards()` 在 `@Transactional` 的 `post()` 循环内调用，评估发生在入账事务提交之前 | 部分 |
| BR-POST-02 | 评估调用异常只记 `WARN`（日志只含 transactionId），不回滚交易、不影响入账结果 | `PostingService.evaluateRewards()` 捕获 `RuntimeException` 后 `log.warn`；日志另含异常信息 | 部分 |
| BR-POST-03 | 评估调用最坏增加入账耗时 2 秒（营销超时） | `RestClientConfig.marketingRestClient()` 读超时取 `client.read-timeout`，默认 3s | 部分 |
| BR-POST-04 | 评估幂等：`reward_grant` 对 `(campaign_id, transaction_id)` 唯一；重复评估返回既有奖励（`duplicate=true`），不重复发奖 | 唯一约束 `uk_reward_campaign_txn`；`RewardEvaluationService.evaluate()` 跳过已评估交易并记 `ALREADY_EVALUATED`，响应中没有 `duplicate` 字段 | 部分 |
| BR-POST-05 | 返现入账幂等：同一 `rewardId` 重复调用返回当前账户，不重复扣减欠款 | `AccountApplicationService.creditCashback()` 先查 `existsByRewardId()`；`reward_credit.reward_id` 为主键 | 已实现 |
| BR-POST-06 | 现金奖励下游失败时保留 `PENDING`，经 `POST /api/v1/rewards/{rewardId}/fulfill` 人工重试，重试仍幂等 | `RewardEvaluationService.evaluate()` / `fulfill()` 调用 `markPending()`；重试沿用同一 `rewardId` | 已实现 |
| BR-POST-07 | 活动效果接口展示发放成功率与预算使用率，PENDING 数量纳入监控 | `GET /api/v1/campaigns/{id}/performance` 返回 `grantedCount`、`pendingCount`、`budgetUtilization`；代码仓未见监控告警配置 | 部分 |
| BR-POST-08 | 回退：关闭 `marketing.enabled` 即停止调用营销，营销数据独立库，不影响账务 | `PostingService` 读取 `marketing.enabled`（默认 `true`） | 已实现 |
| BR-POST-09 | 下一阶段改为入账写 outbox、营销订阅事件（方案 B），保留现有幂等键与接口语义 | 待实现 | 待实现 |

来源：设计文档 / ADR-009-marketing-integration.md「决策」1–5、「后果」；落点：carddemo-java-1025 / services/transaction-service、services/marketing-service、services/account-service

## 2. 鉴权范围（iam-service）

| 规则 | 内容 | 落点 | 状态 |
|---|---|---|---|
| BR-SEC-01 | iam-service 提供登录 `POST /api/v1/auth/login` 与校验 `POST /api/v1/auth/verify` | `AuthController`、`AuthenticationService` | 已实现 |
| BR-SEC-02 | token = `base64(payload).base64(HMAC-SHA256(payload, secret))`，payload 含 userId、userType、过期时间 | `HmacTokenService.issue()` / `verify()`：校验签名、字段与过期时间 | 已实现 |
| BR-SEC-03 | 登录后按用户类型分流菜单：`A` 进入管理员菜单，其他按普通用户；服务端不做细粒度授权 | `User.landingMenu()` | 已实现 |
| BR-SEC-04 | 资源服务本期不强制校验 token，属已登记风险 | 各资源服务没有 token 校验过滤器；web-ui 请求带 `Authorization: Bearer`，下游不校验 | 已实现 |
| BR-SEC-05 | 只在环回地址 / 本地 Compose 演示环境暴露端口，未鉴权 API 不得暴露公网 | `docker-compose.yml` 端口映射（如 `"8081:8081"`）未限定 127.0.0.1；风险登记见 `docs/ops/01-docker-runbook.md` §7 | 部分 |
| BR-SEC-06 | 生产化前必须实施方案 C：API 网关 + JWT 资源服务器统一鉴权，并增加 mTLS / 内网隔离 | 待实现（web-ui `ApiProxyController` 只按路径转发，不鉴权） | 待实现 |
| BR-SEC-07 | 若必须立即上线，过渡采用方案 B：6 个服务加同一份 `TokenValidationFilter` | 待实现 | 待实现 |

来源：设计文档 / ADR-007-authentication-scope.md「决策」「后果」；落点：carddemo-java-1025 / services/iam-service、services/web-ui、docker-compose.yml

## 使用提示

- 修改奖励评估、返现入账或鉴权相关逻辑前，先核对本目录对应规则，并在提交说明中写明规则编号。
- 状态为“待确认”的规则不要自行补齐，需先与业务确认。
