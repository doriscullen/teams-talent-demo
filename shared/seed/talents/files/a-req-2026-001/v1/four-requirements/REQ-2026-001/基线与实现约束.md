# REQ-2026-001 · 基线与实现约束

代码核对基线：`5eeddd63184eb17876bd09d89ea45082644b56db`，分支 `develop`；来源为该提交的 Maven 根 pom 和 ADR-007。任务实际基线以工作区绑定的 commit 为准，后续合入应重新核对，不把本清单当实时库存。

已存在模块：iam-service、customer-service、card-service、account-service、transaction-service、authorization-service、marketing-service、web-ui。Java 21、Spring Boot 3.3.6、Maven、PostgreSQL、原生静态 SPA。

材料 README 所称 dev-b 未在当前仓库可访问 refs 中找到。当前上述基线没有 billing、ledger、notification、audit、limit、workflow、dispute、document 独立服务；原需求“复用现有服务”的假设须先核对。不能把空目录、stub、预置数据或未调用适配器报告为实际集成成功。新增服务、并入已有边界或其它方案由确认后的设计说明决定，保留未实现/阻塞证据。

## 当前工程约束

- Maven使用JDK 21。实际单元测试命令、工作目录、commit、退出码、Surefire报告记录在开发结果中；测试失败需修复并重新执行。
- 服务已有JUnit/Mockito/H2测试不证明PostgreSQL、多服务、Docker或业务集成已完成；按所选方案准备并执行功能/集成测试。
- Java金额使用BigDecimal，幂等/状态并发/异常资金一致性需覆盖。通知失败与资金失败的语义遵照本需求，不统一吞错。
- 静态检查和安全扫描工具须先核实可用版本与配置；Agent Review独立记录，不把静态分析/安全Skill文本当实际扫描结果。
- 只在明确绑定的需求分支工作目录修改本需求业务文件；PR base为develop。初始化不代表开始开发，原未提交代码不自动带入新分支。

## 本需求接口、数据与依赖原文

## 7. 接口与集成

| 接口 | 方向 | 说明 |
|------|------|------|
| POST `/api/v1/installments/preview` | 前端 → installment-service | 试算（不落库），返回试算令牌与明细 |
| POST `/api/v1/installments` | 前端 → installment-service | 创建分期（201，带去重键） |
| GET `/api/v1/installments?accountId=&status=` | 前端 → installment-service | 我的/账户分期列表 |
| GET `/api/v1/installments/{id}` | 前端 → installment-service | 详情 + 还款计划 |
| POST `/api/v1/installments/{id}/early-settlement` | 前端 → installment-service | 提前结清试算与执行 |
| GET `/api/v1/admin/installments?accountId=&status=&page=&size=` | 后台 → installment-service | 后台查询与导出 |
| 交易入账事件 | transaction-service → installment-service | 提供分期资格字段来源 |
| 额度占用/释放 | installment-service → account-service | 建计划占用剩余本金，结清释放 |
| 手续费收入过账 | installment-service → ledger-service | 手续费与违约金分录 |
| 分期通知 | installment-service → notification-service | 建计划、结清通知（失败不回滚） |
| 审计事件 | installment-service → audit-service | actor/action/resource/payload |

创建请求示例：

```json
{"idempotencyKey":"ins-20261027-001","accountId":"00000000006",
 "sourceType":"TRANSACTION","sourceId":"0000000000000200",
 "principal":1000.00,"termMonths":6,"agreementAccepted":true}
```

错误码清单：

| 错误码 | HTTP | 触发条件 |
|--------|------|---------|
| `INSTALLMENT_NOT_ELIGIBLE` | 409 | 金额不足、状态不支持、已逾期或争议中 |
| `ALREADY_INSTALLED` | 409 | 交易或账单已有生效计划 |
| `INVALID_TERM` | 409 | 期数不在 3/6/12 |
| `PREVIEW_EXPIRED` | 409 | 试算令牌过期或金额不一致 |
| `PRINCIPAL_EXCEEDS_LIMIT` | 409 | 本金超过可分期余额 |
| `SETTLEMENT_NOT_ALLOWED` | 409 | 计划非 `ACTIVE` |
| `AGREEMENT_REQUIRED` | 400 | 未勾选协议 |
| `INSTALLMENT_NOT_FOUND` | 404 | 计划不存在或越权 |
| `DOWNSTREAM_UNAVAILABLE` | 503 | account/ledger 调用失败 |

## 8. 数据需求

### 8.1 数据字典

**表 `installment_plan`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| plan_id | 分期计划号 | varchar(32) 主键 | installment-service 生成 |
| account_id | 账户号 | varchar(20) 非空，索引 | 请求体/会话 |
| customer_id | 客户号 | varchar(20) 非空 | customer-service |
| source_type | 分期来源类型 | varchar(16)，`TRANSACTION`/`BILL` | 请求体 |
| source_id | 交易号或账单号 | varchar(32) 非空 | 请求体 |
| principal | 分期本金 | numeric(12,2) > 0 | 试算结果 |
| term_months | 期数 | smallint，仅 3/6/12 | 请求体 |
| monthly_fee_rate | 月手续费率 | numeric(6,4) | 定价表 |
| total_fee | 总手续费 | numeric(12,2) ≥ 0 | 计算值 |
| remaining_principal | 剩余本金 | numeric(12,2) ≥ 0 | 结清/还款更新 |
| status | 计划状态 | varchar(16)，`ACTIVE`/`SETTLED`/`CANCELLED` | 状态机 |
| created_at | 创建时间 | timestamptz 非空 | 服务端 |
| settled_at | 结清时间 | timestamptz 可空 | 结清动作 |
| idempotency_key | 去重键 | varchar(64) 唯一索引 | 前端 |
| version | 乐观锁版本 | int 默认 0 | 服务端 |

**表 `installment_schedule`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| schedule_id | 还款计划行号 | varchar(32) 主键 | installment-service 生成 |
| plan_id | 所属计划号 | varchar(32) 外键 | installment_plan |
| installment_no | 期序 | smallint，与 plan_id 联合唯一 | 服务端 |
| due_date | 应还日期 | date 非空 | 账单周期 |
| principal_due | 本期本金 | numeric(12,2) ≥ 0 | 计算值 |
| fee_due | 本期手续费 | numeric(12,2) ≥ 0 | 计算值 |
| total_due | 本期合计 | numeric(12,2) ≥ 0 | 计算值 |
| status | 本期状态 | varchar(16)，`PENDING`/`PAID` | 还款回写 |
| paid_at | 实际还款时间 | timestamptz 可空 | 还款回写 |

**视图扩展 `account_limit_view`**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| installment_occupied | 分期占用额度 | numeric(12,2) ≥ 0，= 生效计划剩余本金合计 | installment_plan |

### 8.2 数据安全

| 维度 | 要求 |
|------|------|
| 脱敏 | 接口响应与日志中的卡号仅保留后 4 位；客户姓名按「姓 + \*」展示；JSON 落库前过滤敏感字段 |
| 加密 | 传输层 HTTPS；数据库连接启用 TLS；不新增需要落地加密的字段（本期仅金额与计划号） |
| 留存 | 分期计划与还款计划按模拟制度留存 5 年；审计事件留存 3 年；去重键随计划同期留存 |
| 访问 | 客户仅可读本人账户数据（越权返回 404）；运营与风控只读；写操作限客服协助场景并写审计 |
| 导出 | 后台导出需 `installment:read:any` 且文件有效期为 24 小时，导出动作写审计 |

## 11. 依赖与约束

### 11.1 依赖

| 依赖对象 | 用途 | 失败影响与处理 |
|---------|------|---------------|
| transaction-service | 交易状态与分期资格字段 | 入口展示重试，不进入申请流程 |
| billing-service | 账单可分期金额 | 试算失败，可重试 |
| account-service | 额度占用与释放 | 提交失败回滚，不产生计划 |
| ledger-service | 手续费与违约金分录 | 提交或结清失败回滚并告警 |
| notification-service | 建计划与结清通知 | 主流程不回滚，记录通知失败待补发 |
| audit-service | 审计事件 | 写失败进入本地重试队列 |
| IAM | 认证与角色 | 无 token 直接 401 |

### 11.2 影响分析

| 维度 | 影响 |
|------|------|
| 前台 | 交易详情、账单页、新增申请页、列表/详情页、后台查询页 |
| 后台 | 新 installment-service；transaction 分期资格、billing 可分期金额、account 额度占用、ledger 手续费收入、notification 通知、audit 审计 |
| 数据 | 2 张新表 + 账户额度视图新增「分期占用」 |
| 接口 | 6 个新接口；交易与账单响应增加分期资格字段 |
| 配置 | Compose 新服务与数据库、web-ui 代理 |
| 测试 | 试算、建计划、去重、资格拦截、提前结清、额度释放、总账分录 |
| 文档 | 本需求、API 目录、服务清单、runbook |

### 11.3 约束

- 技术栈沿用现有 Spring Boot 3 / PostgreSQL / 原生 SPA，不引入新框架。
- 建议新服务 `installment-service :8110`、库 `carddemo_installment`；并入 billing-service 的方案需评审后确定。
- 金额统一 `BigDecimal` / `numeric(12,2)`；ID 遵循现有零填充或 UUID 规范。
- 涉及余额的变更必须经 account-service；涉及会计影响必须过账 ledger-service。
- 所有写接口必须支持去重键；关键操作写审计事件。
