# REQ-2026-004 · 业务规则与范围

来源：用户提供需求 v1.0，以下为完整章节原文；数值按原材料模拟属性使用。

## 3. 范围定义

### 3.1 In-Scope / Out-of-Scope

**In-Scope**

- 从交易详情发起争议（原因码、描述、金额、证据文件）。
- 案件进度、补充材料、撤案。
- 后台案件工作台：受理、审核、临时入账、chargeback、结案。
- 与 transaction、document、account、notification、audit 的集成。
- 时限提醒：受理 1 个工作日、chargeback 30 天。

**Out-of-Scope**

- 卡组织仲裁网络直连与自动报文。
- 欺诈调查（与 fraud-service 的深度联动）。
- 多币种争议换算。

### 3.2 假设与依赖

| 编号 | 假设/依赖 | 说明 |
|------|----------|------|
| A-01 | dispute-service 已有 `dispute_case` 表与基础状态机 | 本需求扩展字段与状态 |
| A-02 | 交易快照由 transaction-service 只读提供 | 争议以交易快照为准，不修改原交易 |
| A-03 | 证据文件存 document-service | 本服务只保存元数据 |
| A-04 | 临时入账通过 account-service 贷记接口 | `creditId` 与 `provisionalCreditId` 一致 |
| A-05 | 通知走 notification-service 模板 | 通知失败不回滚案件处理 |

## 5. 业务规则

| 编号 | 规则 | 来源 | 优先级 | 验证点 |
|------|------|------|--------|--------|
| BR-DSP-01 | 仅已入账交易可争议；交易日期距今天 ≤ 90 天 | 模拟业务确认 | 必须 | 91 天交易返回 `DISPUTE_NOT_ELIGIBLE`；90 天交易可开案 |
| BR-DSP-02 | 同一交易只能有一个进行中争议 | 模拟业务确认 | 必须 | 并发两次开案，`dispute_case` 仅 1 条进行中记录 |
| BR-DSP-03 | 争议金额 > 0 且 ≤ 交易金额 | 模拟业务确认 | 必须 | 金额 0 与超过交易金额均返回 `INVALID_DISPUTE_AMOUNT` |
| BR-DSP-04 | 原因码 FRAUD/UNAUTHORIZED/DUPLICATE/SERVICE_NOT_RECEIVED/OTHER | 模拟业务确认 | 必须 | 5 个原因码全部可提交；非法值返回 400 |
| BR-DSP-05 | FRAUD/UNAUTHORIZED 必须上传至少 1 份证据 | 模拟合规 | 必须 | 无证据提交返回 `EVIDENCE_REQUIRED` |
| BR-DSP-06 | 临时入账必须审核通过，金额 ≤ 争议金额；同一案件只入账一次 | 模拟资金制度 | 必须 | 重复入账返回首次结果，账户余额只增加 1 次 |
| BR-DSP-07 | 案件状态：OPEN→UNDER_REVIEW→PROVISIONAL_CREDIT→CHARGEBACK→WON/LOST→CLOSED | 模拟业务确认 | 必须 | 非法迁移返回 `INVALID_DISPUTE_STATE` |
| BR-DSP-08 | 客户撤案仅 OPEN/UNDER_REVIEW 可操作；已临时入账需主管确认 | 模拟业务确认 | 应该 | `PROVISIONAL_CREDIT` 状态撤案需主管 token，否则 403 |
| BR-DSP-09 | 所有状态迁移、证据、金额变更写审计；证据访问留痕 | 模拟合规 | 必须 | 审计事件覆盖 5 类动作；证据下载产生访问记录 |
