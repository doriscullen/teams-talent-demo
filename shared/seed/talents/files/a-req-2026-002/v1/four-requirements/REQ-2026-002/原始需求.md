# REQ-2026-002 信用卡挂失与补卡 需求说明书

> 深度标记：L2（标准评审级）+ 涉及资金与卡号变更的 L3 深度字段（字段级需求表、异常矩阵、数据字典、场景矩阵）。

## 文档信息

| 项 | 内容 |
|----|------|
| 文档编号 | REQ-2026-002 |
| 版本 | v1.0（模拟） |
| 业务负责人 | 卡片运营中心 卡产品负责人（模拟角色：Product Owner, Card Operations） |
| 需求来源 | 卡片运营中心诉求单 CR-2026-1002「客户自助挂失与补卡」（模拟工单） |
| 档位 | L2 |
| 优先级 | P0 |
| 目标版本 | R1 |
| 状态 | 待评审 |

## 修订记录

| 版本 | 日期 | 修改人 | 修改内容 |
|------|------|--------|---------|
| v0.1 | 2026-10-20 | BA Agent | 初稿：背景、范围、功能清单、业务规则、接口草案、验收场景 |
| v1.0 | 2026-10-27 | BA Agent | 按 BA 需求说明书模板重排为 13 章；补字段级需求表、异常矩阵、数据字典、数据安全、场景矩阵、可执行验收标准、合规标注 |

## 1. 背景与目标

### 1.1 业务背景

客户卡片丢失或被盗后，需要立即停卡并申请补卡；当前系统只能由后台维护卡状态，客户无自助入口，补卡进度不可见，客服工单量集中在进度查询上。
本期提供客户自助挂失、补卡申请、补卡进度查看，并为运营提供补卡队列工作台。

### 1.2 业务目标（可量化）

| 目标 | 量化指标 |
|------|---------|
| 缩短停卡时间 | 挂失从受理到卡状态生效平均耗时由 15 分钟降至 1 分钟 |
| 降低客服负担 | 补卡进度类咨询量下降 40%（对比上线前 3 个月均值） |
| 提升处理时效 | 挂失接口 p95 < 500ms；补卡申请 p95 < 1200ms |

### 1.3 术语表

| 术语 | 定义 |
|------|------|
| 挂失 | 客户主动声明卡片丢失或被盗，系统立即将卡状态置为 `LOST` 并冻结交易 |
| 补卡工单 | 记录一次补卡申请全流程的业务单据，状态 REQUESTED→CARD_PRODUCED→SHIPPED→ACTIVATED/CANCELLED |
| 制卡 | 卡组织或制卡商按新卡号生产实体卡的环节 |
| 快递单号 | 邮寄环节回填的运单号，供客户在进度页查看 |
| 激活 | 新卡首次启用，激活前不可交易 |
| 去重键 | 客户端生成的业务唯一键（接口字段 `idempotencyKey`），同一键重复提交返回同一结果 |

## 2. 用户角色与权限

| 角色 | 职责 | 权限点 |
|------|------|--------|
| 持卡人 | 挂失、申请补卡、查看进度 | `card:loss:self`、`replacement:create:self`、`replacement:read:self` |
| 客服 | 核实身份、代客挂失、补卡异常处理 | `card:loss:assist`、`replacement:read:any`、`replacement:cancel:assist` |
| 制卡运营 | 查看补卡队列、更新制卡/邮寄状态 | `replacement:read:any`、`replacement:status:update` |

## 3. 范围定义

### 3.1 In-Scope / Out-of-Scope

**In-Scope**

- 卡片挂失（立即冻结）、补卡申请、补卡进度、补卡工单。
- 补卡费（模拟 50.00 元）计入账户。
- 新卡号生成与旧卡失效、通知、审计。
- 前台卡片详情、挂失向导、进度页；后台补卡队列。

**Out-of-Scope**

- 快递物流实时轨迹（只记录快递单号与邮寄状态）。
- 境外紧急补卡、临时虚拟卡。
- 挂失后的争议交易处理（见 REQ-2026-004）。

### 3.2 假设与依赖

| 编号 | 假设/依赖 | 说明 |
|------|----------|------|
| A-01 | card-service 提供卡状态机并支持 `LOST` 状态 | 本需求扩展状态迁移，不新建卡表 |
| A-02 | 费用通过 transaction-service 的 `FEE` 批次过账 | 补卡费不走独立收费通道 |
| A-03 | 账户余额变更由 account-service 完成 | 补卡费影响可用余额与总账 |
| A-04 | 快递单号由制卡运营人工回填 | 本期不接物流商接口 |
| A-05 | 通知走 notification-service 模板 | 通知失败不回滚挂失与补卡 |

## 4. 功能需求

### 4.1 功能清单总览

| 模块 | 功能点 | 优先级 | 来源 |
|------|--------|--------|------|
| 挂失 | REQ-LOST-01 卡片详情「挂失」入口 | 必须 | 诉求单 CR-2026-1002 |
| 挂失 | REQ-LOST-02 挂失立即生效 | 必须 | 诉求单 CR-2026-1002 |
| 补卡 | REQ-LOST-03 补卡申请（地址/原因/费用确认） | 必须 | 诉求单 CR-2026-1002 |
| 补卡 | REQ-LOST-04 补卡进度时间线 | 必须 | 诉求单 CR-2026-1002 |
| 补卡 | REQ-LOST-05 补卡费收取 | 必须 | 定价诉求（模拟 50.00 元） |
| 后台 | REQ-LOST-06 后台补卡队列 | 必须 | 卡片运营中心 |
| 后台 | REQ-LOST-07 重复挂失与重复补卡去重 | 必须 | 风控与财务诉求 |

### 4.2 详细功能需求

#### REQ-2026-002-01 卡片详情「挂失」入口（REQ-LOST-01）

**功能描述**：在卡片详情页对 `ACTIVE` 卡展示「挂失」按钮，进入挂失确认弹窗（风险提示、原因选择、输入卡号后 4 位）；非 `ACTIVE` 卡不展示入口。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| cardNumber | string(19) | 是 | 16 位数字串，须属于当前登录客户 | 无 | 路由路径参数 |
| cardStatus | string(16) | 是 | 仅 `ACTIVE` 展示入口 | `ACTIVE` | card-service |
| reason | string(16) | 是 | 枚举 `LOST`/`STOLEN`/`DAMAGED` | 无 | 前端下拉 |
| confirmCardLast4 | string(4) | 是 | 4 位数字，必须与卡号后 4 位一致 | 空 | 前端输入 |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 卡片非 `ACTIVE`（已挂失/冻结/销户） | 不展示挂失按钮 | `CARD_NOT_ACTIVE` | 「当前卡片状态不支持挂失」 |
| 卡号后 4 位输入错误 | 前端拦截，不发起请求 | 无（前端校验） | 「卡号后 4 位不匹配」 |
| 卡片不属于当前客户 | 返回 404，不泄露卡存在性 | 无（`404`） | 「卡片不存在」 |
| card-service 超时（> 500ms） | 按钮置为不可用并展示重试 | `DOWNSTREAM_UNAVAILABLE` | 「卡片信息加载失败，请重试」 |

#### REQ-2026-002-02 挂失立即生效（REQ-LOST-02）

**功能描述**：客户确认后立即将卡状态由 `ACTIVE` 置为 `LOST`，阻断后续交易授权，写 `card_operation` 与审计事件，并发送通知。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| idempotencyKey | string(64) | 是 | 客户端生成，唯一，重复提交返回首次结果 | 无 | 前端 |
| cardStatus | string(16) | 是 | 由 `ACTIVE` 迁移到 `LOST`，不可回退 | 无 | card-service 状态机 |
| operationType | string(16) | 是 | 固定 `LOSS` | `LOSS` | card-service |
| actor | string(64) | 是 | 客户号或客服工号，取自 token | 无 | IAM token |
| maskedCardNumber | string(19) | 是 | 仅存前 6 位与后 4 位，中间以 \* 掩码 | 计算值 | card-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 卡片已挂失，重复提交 | 返回首次结果（HTTP 200），不重复通知 | `CARD_ALREADY_LOST` | 「该卡已挂失，无需重复操作」 |
| 同一去重键重复提交 3 次 | 只产生 1 条 `card_operation` | 无（去重命中） | 「挂失已生效」 |
| 状态迁移并发冲突（version 不一致） | 乐观锁拒绝，提示刷新 | `CONCURRENT_MODIFICATION` | 「卡片状态已变化，请刷新后重试」 |
| notification-service 失败 | 挂失仍生效，记录通知失败待补发 | 无（主流程成功） | 「挂失已生效，通知将稍后送达」 |
| 审计写入失败 | 挂失生效并写本地补偿日志 | 无（主流程成功） | 「挂失已生效」 |

#### REQ-2026-002-03 补卡申请（REQ-LOST-03）

**功能描述**：客户在挂失后发起补卡，确认或修改收卡地址、选择补卡原因与配送方式，确认费用后创建补卡工单并生成新卡号；旧卡永久失效。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| cardNumber | string(19) | 是 | 必须为 `LOST` 状态且属于当前客户 | 无 | 路由路径参数 |
| addressId | string(32) | 是 | 存在于客户地址簿 | 默认地址 | customer-service |
| deliveryMethod | string(16) | 是 | 枚举 `STANDARD`/`EXPRESS` | `STANDARD` | 前端选择 |
| reason | string(16) | 是 | 枚举 `LOST`/`STOLEN`/`DAMAGED` | 继承挂失原因 | 前端下拉 |
| feeAmount | decimal(12,2) | 是 | ≥ 0；白金卡 0.00，其余 50.00 | 按卡级别取值 | 定价规则 |
| newCardNumber | string(19) | 是 | 16 位，BIN 段与卡组织规范一致，唯一 | 服务端生成 | card-service |
| idempotencyKey | string(64) | 是 | 唯一；同一键返回同一工单 | 无 | 前端 |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 同一卡已有进行中补卡工单 | 拒绝创建，返回已有工单 | `REPLACEMENT_EXISTS` | 「该卡已有进行中的补卡申请」 |
| 卡片非 `LOST` 状态 | 拒绝创建 | `CARD_NOT_ACTIVE` | 「请先完成挂失再申请补卡」 |
| 地址 ID 不存在或不属于客户 | 参数校验失败 | `INVALID_ADDRESS` | 「收卡地址无效，请重新选择」 |
| 新卡号生成失败（号段耗尽或校验位冲突） | 工单保持 `REQUESTED` 并告警，支持重试 | `CARD_NUMBER_GENERATION_FAILED` | 「补卡申请已受理，制卡信息生成中」 |
| 同一去重键重复提交 | 返回首次创建的工单 | 无（去重命中） | 「补卡申请已提交」 |

#### REQ-2026-002-04 补卡进度（REQ-LOST-04）

**功能描述**：客户查看补卡工单时间线（已申请→制卡中→已寄出→已激活），运营更新状态后客户侧实时可见；客户只读，不可修改状态。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| replacementId | string(32) | 是 | 存在且工单属于当前客户 | 无 | 路由路径参数 |
| status | string(16) | 是 | 枚举 `REQUESTED`/`CARD_PRODUCED`/`SHIPPED`/`ACTIVATED`/`CANCELLED` | `REQUESTED` | card_replacement |
| trackingNo | string(32) | 否 | 仅 `SHIPPED` 之后必填 | 空 | 运营回填 |
| estimatedArrival | date | 否 | 仅 `SHIPPED` 之后展示，≥ 寄出日期 + 3 天 | 空 | 运营回填 |
| statusUpdatedAt | timestamptz | 是 | 每次状态迁移刷新 | 创建时间 | card-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 工单不属于当前客户 | 返回 404 | 无（`404`） | 「补卡记录不存在」 |
| 状态为 `SHIPPED` 但快递单号为空 | 展示「物流信息同步中」，客服可介入 | `TRACKING_MISSING` | 「物流信息同步中，可联系客服」 |
| 运营回填非法状态迁移（如 `REQUESTED` 直接到 `ACTIVATED`） | 拒绝更新 | `INVALID_STATE_TRANSITION` | 后台提示「状态迁移不合法」 |

#### REQ-2026-002-05 补卡费收取（REQ-LOST-05）

**功能描述**：申请页展示补卡费；确认后通过 transaction-service 的 `FEE` 批次计入账户与总账；过账失败时工单保留并标记 `FEE_PENDING`，支持重试补收。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| feeAmount | decimal(12,2) | 是 | ≥ 0，白金卡 0.00，其余 50.00 | 按卡级别取值 | 定价规则 |
| feeBatchId | string(32) | 否 | 过账成功后回填，唯一 | 空 | transaction-service |
| feeStatus | string(16) | 是 | 枚举 `CHARGED`/`FEE_PENDING`/`WAIVED` | `CHARGED` | card-service |
| accountId | string(20) | 是 | 工单关联账户，须存在 | 卡关联账户 | account-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| transaction-service 过账失败 | 工单保留，标记 `FEE_PENDING`，进入重试队列 | `FEE_POSTING_FAILED` | 「补卡申请已受理，费用将在 24 小时内补收」 |
| 同一工单重复触发收费 | 按 `feeBatchId` 去重，不重复扣费 | 无（去重命中） | 无提示 |
| 白金卡费用为 0.00 | 不产生过账，`feeStatus` 置 `WAIVED` | 无 | 「白金卡免收补卡费」 |
| 账户余额不足 | 允许欠款入账，按现有账单规则计息 | 无 | 「费用已入账」 |

> 说明：未单独展开的 REQ-LOST-06（后台补卡队列）与 REQ-LOST-07（重复挂失与补卡去重）由 4.1 功能清单、第 5 章业务规则与第 9 章场景矩阵覆盖，接口定义见第 7 章。

### 4.3 界面改造清单

| 页面 | 改造 |
|------|------|
| 卡片详情 `#/cards/{cardNumber}` | 新增「挂失」红色按钮；`LOST` 状态显示补卡入口与进度 |
| 挂失确认弹窗 | 风险提示、原因选择、确认卡号后 4 位 |
| 补卡向导 `#/cards/{cardNumber}/replacement` | 地址确认/修改、费用展示、提交 |
| 补卡进度 `#/replacements/{id}` | 时间线、预计到达、客服入口 |
| 后台补卡队列 `#/admin/replacements` | 状态筛选、工单详情、状态更新、导出 |

页面状态：加载中、无资格、提交中、成功、重复提交、下游失败。

## 5. 业务规则

| 编号 | 规则 | 来源 | 优先级 | 验证点 |
|------|------|------|--------|--------|
| BR-LOST-01 | 仅 `ACTIVE` 卡可挂失；已挂失/冻结/销户返回 409 | 模拟业务确认 | 必须 | 三类非 ACTIVE 卡调用挂失接口均返回 `CARD_NOT_ACTIVE` |
| BR-LOST-02 | 挂失不可撤销；补卡可取消（制卡前） | 模拟业务确认 | 必须 | 挂失接口无撤销路径；`SHIPPED` 后取消返回 `REPLACEMENT_NOT_CANCELLABLE` |
| BR-LOST-03 | 补卡费 50.00 元，白金卡免收；费用计入账户 | 模拟定价 | 必须 | 白金卡 `feeStatus=WAIVED`；金卡/普卡生成 50.00 元 FEE 过账 |
| BR-LOST-04 | 补卡生成新卡号，旧卡永久失效；新卡未激活前不可交易 | 模拟业务确认 | 必须 | 旧卡号授权返回拒绝；新卡 `ACTIVATED` 前交易被拒 |
| BR-LOST-05 | 补卡工单状态：REQUESTED→CARD_PRODUCED→SHIPPED→ACTIVATED/CANCELLED | 模拟业务确认 | 必须 | 非法迁移被拒绝并返回 `INVALID_STATE_TRANSITION` |
| BR-LOST-06 | 同一卡同一时间只能有一个进行中补卡工单 | 模拟业务确认 | 必须 | 并发两次申请，`card_replacement` 仅 1 条进行中记录 |
| BR-LOST-07 | 挂失/补卡必须写审计（actor、卡号掩码、原因） | 模拟合规 | 必须 | 审计事件含 actor、maskedCardNumber、reason 三字段 |

## 6. 非功能需求

### 6.1 性能、可用性与可观测性

| 维度 | 指标 | 验证方法 |
|------|------|---------|
| 性能 | 挂失 p95 < 500ms；补卡申请 p95 < 1200ms；进度查询 p95 < 800ms | 压测 50 并发，取 p95 |
| 可用性 | 依赖不可用返回明确错误码；挂失不受通知失败影响 | 停用 notification-service 后挂失，断言卡状态为 LOST |
| 一致性 | 挂失与卡状态迁移在同一事务内完成 | 并发挂失断言只有 1 条 `card_operation` |
| 去重 | 挂失与补卡申请支持去重，重复请求返回首次结果 | 同一去重键提交 3 次，断言记录数为 1 |
| 可观测性 | 每次状态迁移输出 traceId、cardNumberLast4、replacementId | 日志检索与指标验证 |
| 可维护性 | 状态机与费用规则配置化，新增配送方式不改代码 | 代码评审 + 配置化用例 |

### 6.2 安全需求

| 维度 | 要求 | 验证方法 |
|------|------|---------|
| 认证 | 全部接口需 IAM 签发的 JWT；无 token 返回 401 | 无 token 调用 7 个接口 |
| 授权 | 客户仅可操作本人卡；越权返回 404；后台接口仅 `A` 角色 | 用 A 客户 token 操作 B 客户卡片 |
| 身份核实 | 挂失需输入卡号后 4 位；客服代客挂失需工单号 + 客户身份核实记录 | 客服界面强制填写核实方式 |
| 数据保护 | 卡号在日志、事件、响应中只展示后 4 位；数据库存储掩码卡号与密文卡号分列 | 日志检索完整卡号（应为 0 命中） |
| 防滥用 | 同一客户 24 小时内挂失请求 > 3 次触发风控告警 | 构造 4 次请求，断言告警事件 |
| 审计 | 挂失、补卡、状态更新、费用过账写审计 | 查询 audit-service 事件完整性 |

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

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | `ACTIVE` 卡挂失 | 持卡人 | POST `/cards/4000000000005740/loss` | 201，`cardStatus=LOST`，`card_operation` 新增 1 条，通知发出 |
| 主流程 | 挂失后申请补卡（金卡） | 持卡人 | POST `/cards/{cardNumber}/replacements` | 201，工单 `REQUESTED`，`feeAmount=50.00`，FEE 过账成功 |
| 主流程 | 运营更新为 `SHIPPED` | 制卡运营 | POST `/admin/replacements/{id}/status` | 200，客户进度页展示快递单号与预计到达日期 |
| 边界 | 白金卡申请补卡 | 持卡人 | 白金卡工单，`feeAmount=0.00` | `feeStatus=WAIVED`，无 FEE 过账 |
| 边界 | 卡片刚挂失 1 秒内立即申请补卡 | 持卡人 | POST `/replacements` | 201，工单创建成功，状态 `REQUESTED` |
| 边界 | 同一去重键在 30 分钟窗内第 3 次提交 | 持卡人 | POST `/replacements`，去重键固定 | 返回同一 `replacement_id`，工单数不变 |
| 异常 | 已挂失卡再次挂失 | 持卡人 | POST `/loss` | 409 `CARD_ALREADY_LOST`，审计仅 1 条 LOSS 记录 |
| 异常 | 补卡进行中再次申请 | 持卡人 | POST `/replacements` | 409 `REPLACEMENT_EXISTS` |
| 异常 | 费用过账时 transaction-service 不可用 | 持卡人 | 停用 transaction-service 后申请补卡 | 工单存在且 `feeStatus=FEE_PENDING`，恢复后自动补收 |
| 异常 | 运营在 `REQUESTED` 直接置 `ACTIVATED` | 制卡运营 | POST `/admin/replacements/{id}/status` | 409 `INVALID_STATE_TRANSITION` |
| 权限 | 客户 A 查看客户 B 的补卡工单 | 持卡人 | GET `/replacements/{id}` | 404，「补卡记录不存在」 |
| 权限 | 客服代客挂失 | 客服 | POST `/loss`，token 含 `card:loss:assist` | 201，审计 actor 为客服工号，记录核实方式 |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 存在 `ACTIVE` 卡 4000000000005740 | 客户确认挂失 | 卡状态立即 `LOST`，旧卡授权被拒，审计可查 | 卡与账户 00000000006 |
| US-002 | 卡已 `LOST` | 再次提交挂失 | 409 `CARD_ALREADY_LOST`，通知仅 1 条 | 复用 US-001 数据 |
| US-003 | 白金卡已挂失 | 提交补卡申请 | `feeAmount=0.00`、`feeStatus=WAIVED`，无 FEE 过账 | 白金卡 4000000000009999 |
| US-004 | 金卡已挂失 | 提交补卡申请 | `feeAmount=50.00`，生成 FEE 过账，`fee_batch_id` 回填 | 金卡 4000000000005740 |
| US-005 | 存在进行中补卡工单 | 再次提交补卡 | 409 `REPLACEMENT_EXISTS`，工单数不变 | 复用 US-004 数据 |
| US-006 | 工单状态 `CARD_PRODUCED` | 运营更新为 `SHIPPED` 并回填单号 | 客户进度页展示快递单号与预计到达日期 | 工单 `replacement_id` |
| US-007 | 新卡已生成未激活 | 用新卡发起交易 | 交易被拒，提示「新卡未激活」 | 新卡号 + 交易请求 |
| US-008 | 停用 transaction-service | 提交金卡补卡申请 | 工单创建成功且 `feeStatus=FEE_PENDING`；恢复后 24 小时内补收成功 | 停用与恢复容器 |

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

## 12. 风险与假设

### 12.1 风险与应对

| 风险/假设 | 影响 | 应对 |
|-----------|------|------|
| 新卡号生成规则（BIN 段与校验位）未与卡组织规范对齐 | 卡号无效，实体卡无法使用 | 上线前用卡组织测试号段验证 1000 个卡号，全部通过 Luhn 校验 |
| 补卡费减免策略为模拟值 | 客户投诉或收入偏差 | 定价确认后仅改配置；v1.1 前配置项标记 `SIMULATION` |
| 快递单号靠人工回填 | 客户进度页长时间无物流信息 | `SHIPPED` 后 24 小时未回填触发运营告警 |
| 挂失后客户立即补卡，地址已失效 | 补卡邮寄失败 | 申请时调用 customer-service 校验地址有效性 |
| 假设单卡补卡工单不设次数上限 | 恶意重复申请 | 24 小时内 > 3 次触发风控告警与人工审核 |

### 12.2 假设

- 旧卡在挂失后立即失效，不保留宽限期。
- 补卡制卡与邮寄周期由卡组织与物流商决定，系统只记录状态。

### 12.3 待确认事项

1. 挂失后是否自动发起补卡（待确认：默认人工发起，产品确认后改为可选自动）。
2. 客户是否可取消补卡及可取消的截止状态（待确认：当前设计为制卡前可取消）。
3. 补卡新卡号生成规则与 BIN 段（待确认：卡组织规范对齐）。
4. 补卡费减免策略与白金卡范围（待确认：定价与产品确认）。
5. 补卡费欠款是否计入最低还款额（待确认：账单规则负责人确认）。

## 13. 合规标注

| 维度 | 标注 |
|------|------|
| 监管（模拟） | 参照《商业银行信用卡业务监督管理办法》关于卡片挂失、补发与费用披露的要求，挂失入口与补卡费用在申请页明示。本文件为演示材料，不构成监管合规结论。 |
| 制度（模拟） | 参照行内卡片安全管理办法（模拟编号 CARD-POLICY-2026）：挂失不可撤销，补卡需核实收卡地址。 |
| SoD（职责分离） | 制卡运营只可更新工单状态，不可发起挂失与补卡；挂失由客户或客服发起；费用过账由 transaction-service 记账，运营无手工调账权限。 |
| 隐私（模拟） | 参照《个人信息保护法》，收卡地址以 `addressId` 引用，不在补卡工单中冗余明细；卡号密文存储与掩码展示。 |
| 审计 | 挂失、补卡、状态迁移、费用过账全量留痕，审计留存 3 年。 |
| 结论 | 模拟需求，费用与时效为演示假设，投产前需法务、合规、卡片运营三方会签。 |

---

## 附录 A 章节编号对照（检查脚本兼容）

| 旧版脚本章节 | 本文件章节 | 脚本匹配标题 |
|-------------|-----------|-------------|
| 10. 风险与应对 | 12. 风险与假设 | `## 10. 风险与应对` |
| 11. 合规标注 | 13. 合规标注 | `## 11. 合规标注` |
