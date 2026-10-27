# ADR-011：账单分期所需「账单能力」的落地方式

| 项 | 内容 |
|----|------|
| 编号 | ADR-011 |
| 日期 | 2026-10-28 |
| 状态 | 已接受（最小实现；正式账单改造另行评审） |
| 关联需求 | REQ-2026-001（PRD v1.1 D-10、12-9），US-001/AC-09 |

## 背景

PRD 要求账单分期 ≥ 500.00、账单与单笔分期按本金去重、T+1 首期计入下一账单周期。但基线没有 billing 服务与账期模型（A-02 假设「账单可分期金额由 billing-service 提供」在基线不成立）。

## 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 新建独立 billing-service | 完整账单域（账单生成、账期、还款） | 领域边界最清晰 | 工作量与影响面远超本需求；重复造账单域 |
| B. 在分期服务内实现最小账单能力 | 按账户开卡日为锚点取本账期已入账消费，实时计算可分期本金 | 满足分期所需，边界最小；真实数据来源（transaction-service） | 不是完整账单域，账期规则需后续与正式账单对齐 |
| C. 只从 account.currentBalance 取金额 | 复用账户余额 | 最省事 | 无法做「账单内交易本金去重」，AC-09 无法验证；无法表达账期 |

## 决策

采用 **B**：`BillingStatementService`

- 账期起点 = 上月同日（按 `account.openDate` 的日号），月末自动截断（`min(day, lengthOfMonth)`），终点 = 当前日（`Asia/Shanghai`）。
- 账单行 = 该区间内 `typeCode=01` 且 `status=POSTED` 的交易，按时间排序。
- `billPrincipal` = 行金额合计；`availablePrincipal` = 各行 `金额 − 已占用本金`（与 `installment_principal_allocation` 交叉去重，BR-INS-09）。
- `billId = BILL + yyyyMM + accountId`（≤32 位，符合 ID 长度约束）。

## 后果

- 正面：AC-09（单笔与账单交叉去重）、AC-18（账期归属）可执行且数据可追溯。
- 负面：这是「分期视角的最小账单」，不是完整账单系统；正式账单改造、账单日/还款日政策仍属 PRD §12-9 待确认。
- 回退：后续若新建 billing-service，`BillingPort` 契约不变，仅替换实现。
