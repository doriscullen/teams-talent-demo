> v2 节点资料：以下原始章节/历史基线摘录保持原意。当前本地测试参数以本目录 `test-profile.md` v2 为准；正式第 12.3 节仍待确认。不得自行把其它推断政策转成已确认。

# REQ-2026-002 · 基线与实现约束

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
| POST `/api/v1/cards/{cardNumber}/loss` | 前端 → card-service | 挂失（去重，201 首次 / 200 重复） |
| POST `/api/v1/cards/{cardNumber}/replacements` | 前端 → card-service | 补卡申请（201） |
| GET `/api/v1/cards/{cardNumber}/replacements` | 前端 → card-service | 该卡补卡记录 |
| GET `/api/v1/replacements/{id}` | 前端 → card-service | 进度时间线 |
| POST `/api/v1/replacements/{id}/cancel` | 前端 → card-service | 取消（制卡前） |
| GET `/api/v1/admin/replacements?status=&page=&size=` | 后台 → card-service | 补卡队列 |
| POST `/api/v1/admin/replacements/{id}/status` | 后台 → card-service | 更新制卡/邮寄/完成 |
| FEE 过账 | card-service → transaction-service | 补卡费计入账户与总账 |
| 余额与账单更新 | transaction-service → account-service | 费用影响可用余额 |
| 挂失/补卡通知 | card-service → notification-service | 邮件、短信、站内信（失败不回滚） |
| 审计事件 | card-service → audit-service | actor/action/resource/payload |
| 地址读取 | card-service → customer-service | 收卡地址校验 |

请求示例：

```json
{"reason":"LOST","confirmCardLast4":"5740"}
{"addressId":"ADDR-001","deliveryMethod":"STANDARD","idempotencyKey":"repl-20261027-001"}
```

错误码清单：

| 错误码 | HTTP | 触发条件 |
|--------|------|---------|
| `CARD_NOT_ACTIVE` | 409 | 卡片非 `ACTIVE`，或补卡前未挂失 |
| `CARD_ALREADY_LOST` | 409 | 重复挂失 |
| `REPLACEMENT_EXISTS` | 409 | 已有进行中补卡工单 |
| `REPLACEMENT_NOT_CANCELLABLE` | 409 | 工单已制卡或已寄出 |
| `INVALID_STATE_TRANSITION` | 409 | 非法状态迁移 |
| `INVALID_ADDRESS` | 400 | 地址不存在或不属于客户 |
| `FEE_POSTING_FAILED` | 202 | 工单已创建但费用待补收 |
| `CONCURRENT_MODIFICATION` | 409 | 乐观锁冲突 |
| `DOWNSTREAM_UNAVAILABLE` | 503 | card/customer/transaction 依赖失败 |

## 8. 数据需求

### 8.1 数据字典

**表 `card_operation`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| operation_id | 卡操作流水号 | varchar(32) 主键 | card-service 生成 |
| card_number | 卡号（掩码存储） | varchar(19) 非空，索引 | 请求参数 |
| operation_type | 操作类型 | varchar(16)，`LOSS`/`REPLACE`/`CANCEL` | 业务动作 |
| status | 操作状态 | varchar(16)，`SUCCESS`/`FAILED`/`PENDING` | 状态机 |
| reason | 操作原因 | varchar(16)，`LOST`/`STOLEN`/`DAMAGED` | 前端下拉 |
| actor | 操作人 | varchar(64) 非空 | IAM token |
| created_at | 操作时间 | timestamptz 非空 | 服务端 |
| payload | 请求快照 | jsonb，敏感字段已脱敏 | 服务端 |

**表 `card_replacement`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| replacement_id | 补卡工单号 | varchar(32) 主键 | card-service 生成 |
| old_card_number | 旧卡号（掩码存储） | varchar(19) 非空 | 请求参数 |
| new_card_number | 新卡号（掩码存储，密文列另存） | varchar(19) 唯一 | card-service 生成 |
| account_id | 关联账户号 | varchar(20) 非空，索引 | card-service |
| customer_id | 客户号 | varchar(20) 非空 | customer-service |
| address_id | 收卡地址 | varchar(32) 非空 | customer-service |
| fee_amount | 补卡费 | numeric(12,2) ≥ 0 | 定价规则 |
| fee_batch_id | 费用过账批次 | varchar(32) 可空 | transaction-service |
| status | 工单状态 | varchar(16)，5 个枚举值 | 状态机 |
| tracking_no | 快递单号 | varchar(32) 可空 | 运营回填 |
| requested_at | 申请时间 | timestamptz 非空 | 服务端 |
| shipped_at | 寄出时间 | timestamptz 可空 | 运营回填 |
| activated_at | 激活时间 | timestamptz 可空 | 激活动作 |
| idempotency_key | 去重键 | varchar(64) 唯一索引 | 前端 |
| version | 乐观锁版本 | int 默认 0 | 服务端 |

**卡表扩展**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| card.status | 卡状态 | varchar(16) 新增枚举值 `LOST` | card-service 状态机 |

### 8.2 数据安全

| 维度 | 要求 |
|------|------|
| 脱敏 | 卡号在接口响应、日志、审计事件中仅展示后 4 位；页面展示按 `\*\*\*\* \*\*\*\* \*\*\*\* 5740` 格式 |
| 加密 | 完整卡号落库使用密文列（AES-256，密钥由 KMS 托管）；传输层 HTTPS |
| 留存 | 挂失与补卡工单留存 5 年；审计事件留存 3 年；快递单号随工单同期留存 |
| 访问 | 客户仅可访问本人卡片与工单；运营可查全部工单但不可修改卡号；导出文件 24 小时自动失效 |
| 最小化 | 不采集客户身份证影像与家庭地址明细，仅引用 `addressId` |

## 11. 依赖与约束

### 11.1 依赖

| 依赖对象 | 用途 | 失败影响与处理 |
|---------|------|---------------|
| card-service | 卡状态机、卡号生成 | 挂失与补卡不可用，返回 503 |
| customer-service | 地址簿读取与校验 | 补卡申请拒绝，提示地址无效 |
| transaction-service | 补卡费 FEE 过账 | 工单保留 `FEE_PENDING`，重试补收 |
| account-service | 余额与账单更新 | 费用延后入账，不阻塞工单 |
| notification-service | 挂失与补卡通知 | 主流程不回滚，记录待补发 |
| audit-service | 审计事件 | 写失败进入本地补偿日志 |
| IAM | 认证与角色 | 无 token 返回 401 |

### 11.2 影响分析

| 维度 | 影响 |
|------|------|
| 前台 | 卡片详情、挂失确认弹窗、补卡向导、进度页、后台队列 |
| 后台 | card-service 状态机与工单；transaction FEE 过账；notification 通知；audit 审计；account 余额 |
| 数据 | `card_operation`、`card_replacement`；卡表新增 `LOST` 状态 |
| 接口 | 7 个新接口；卡详情响应增加挂失与补卡状态字段 |
| 配置 | 补卡费规则、配送方式、通知模板、快递单号校验规则 |
| 测试 | 挂失去重、补卡唯一、费用过账、新卡失效与激活、状态机、越权 |
| 文档 | 本需求、API 目录、服务清单、挂失应急预案 |

### 11.3 约束

- 复用 card-service，不新建独立补卡服务。
- 卡号生成必须符合卡组织 BIN 段与 Luhn 校验规则。
- 金额统一 `BigDecimal` / `numeric(12,2)`。
- 所有写接口支持去重键；关键操作写审计事件。
- 演示环境沿用 IAM 角色 `U`/`A`，POC 不做接口级强鉴权（ADR-007），但卡片归属校验必须保留。
