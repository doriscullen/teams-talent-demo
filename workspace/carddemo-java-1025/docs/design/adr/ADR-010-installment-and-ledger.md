# ADR-010：分期与总账的边界、服务拆分与一致性

| 项 | 内容 |
|----|------|
| 编号 | ADR-010 |
| 日期 | 2026-10-28 |
| 状态 | 已接受（本地演示；生产化待复核） |
| 关联需求 | REQ-2026-001（PRD v1.1），US-001/002/005/007 |

## 背景

REQ-2026-001 需要「分期计划 + 还款计划 + 提前结清 + 手续费/违约金过账」。基线只有 iam/customer/card/account/transaction/authorization/marketing/web-ui 八个模块，**没有 installment、ledger、billing、notification、audit 服务**（`docs/design/adr/ADR-007`、`services/*` 实测）。PRD 要求：涉及余额的变更必须经 account-service；涉及会计影响必须过账；ledger 失败必须回滚且「US-007 必须具有真实可停用的下游」。

## 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 分期与总账内聚在一个服务（记账写同库表） | 单服务、单库 | 实现最快，事务天然一致 | 无法真实停用「下游」，US-007 只能用异常模拟 → 与 PRD/验收要求冲突 |
| B. 分期服务 + 独立 ledger-service（HTTP 过账） | 两个服务、两个库 | 下游真实可停用/超时，可验证 503 与失败一致性；符合会计边界 | 跨服务一致性需要幂等键 + 意图表 |
| C. 引入消息中间件做最终一致 | 分期 → MQ → ledger | 解耦、可削峰 | 新增组件与运维成本，超出本地演示范围（防过度设计） |

## 量化权衡

| 方案 | 实现成本 | 失败可验证性 | 运维复杂度 | 审计性 | 风险 |
|---|---|---|---|---|---|
| A | 低 | **低**（只能伪造 503） | 低 | 中 | 验收项不可证伪 |
| B | 中 | **高**（停容器即真故障） | 中 | 高（分录可查） | 需要补偿路径 |
| C | 高 | 高 | 高 | 高 | 超出本期范围 |

## 决策

采用 **B**：

1. 新增 `installment-service`（8088，库 `carddemo_installment`）承载分期计划、还款计划、试算、结清编排、账单能力、审计与通知发件箱。
2. 新增 `ledger-service`（8089，库 `carddemo_ledger`），提供 `POST /api/v1/journal-entries`，按 `entryGroupId` 幂等。
3. 一致性：创建分期使用「本地事务 + 过账调用 + 抛错回滚」；结清使用「意图表 + 分步提交（PENDING → LEDGER_POSTED → COMPLETED）」，同一 `settlementIdempotencyKey` 可安全续跑。
4. 余额只经 account-service `payments` 变更；分期服务不直写账户库。

## 后果与回退

- 正面：US-007 可通过停用 ledger 容器真实验证；分录可查、可对账。
- 负面：跨服务步骤存在短窗口不一致（ledger 已过账但计划未结清），由意图表状态与同键重试收敛；生产化需补 outbox/补偿 worker。
- 回退：若后续决定内聚，可把 ledger-service 作为模块并入分期服务，接口契约不变。
