# REQ-2026-004 交易争议在线申请与处理 需求说明书

> 深度标记：L3（涉及资金/证据/时限）——字段级需求表、异常矩阵、数据字典、场景矩阵为必填项。

## 文档信息

| 项 | 内容 |
|----|------|
| 文档编号 | REQ-2026-004 |
| 版本 | v1.0（模拟） |
| 业务负责人 | 客户服务部 争议处理负责人（模拟角色：Product Owner, Customer Service） |
| 需求来源 | 客户服务部诉求单 CR-2026-1004「交易争议线上化」（模拟工单） |
| 档位 | L3（涉及资金/证据/时限） |
| 优先级 | P1 |
| 目标版本 | R2 |
| 状态 | 待评审 |

## 修订记录

| 版本 | 日期 | 修改人 | 修改内容 |
|------|------|--------|---------|
| v0.1 | 2026-10-20 | BA Agent | 初稿：背景、范围、功能清单、业务规则、接口草案、验收场景 |
| v1.0 | 2026-10-27 | BA Agent | 按 BA 需求说明书模板重排为 13 章；补字段级需求表、异常矩阵、数据字典、数据安全、场景矩阵、可执行验收标准、合规标注 |

## 1. 背景与目标

### 1.1 业务背景

客户对交易有异议时只能电话客服，材料靠邮件传递，进度不可见；争议金额、临时入账与 chargeback 时限容易遗漏。
本期提供客户在线选交易、提交原因与证据、跟踪进度；后台案件工作台统一处理；关键时限自动提醒。

### 1.2 业务目标（可量化）

| 目标 | 量化指标 |
|------|---------|
| 争议线上化 | 争议线上化率 90%（对比上线前 3 个月电话受理占比） |
| 缩短首次响应 | 首案受理响应 < 4 小时 |
| 控制时限风险 | 超时案件 0 起（按季度统计 SLA 违约事件） |
| 提升体验 | 开案 p95 < 1200ms；案件列表 p95 < 800ms |

### 1.3 术语表

| 术语 | 定义 |
|------|------|
| 争议案件 | 客户对某笔交易提出异议后生成的业务单据，状态由 `OPEN` 起算 |
| 原因码 | 争议分类，取值 `FRAUD`/`UNAUTHORIZED`/`DUPLICATE`/`SERVICE_NOT_RECEIVED`/`OTHER` |
| 临时入账 | 审核通过后向客户账户先行贷记争议金额，后续按结论冲回或保留 |
| chargeback | 向卡组织发起退单请求的流程 |
| SLA | 案件处理时限，受理 1 个工作日、chargeback 30 天 |
| 去重键 | 客户端生成的业务唯一键（接口字段 `idempotencyKey`），同一键重复提交返回同一结果 |

## 2. 用户角色与权限

| 角色 | 职责 | 权限点 |
|------|------|--------|
| 持卡人 | 选择交易、提交争议与证据、查看进度、补充材料、撤案 | `dispute:create:self`、`dispute:read:self`、`dispute:evidence:self` |
| 争议专员 | 受理、审核、临时入账、发起 chargeback | `dispute:review`、`dispute:credit`、`dispute:chargeback`、`dispute:read:any` |
| 主管 | 审批临时入账与大额争议、仲裁 | `dispute:approve`、`dispute:read:any`、`dispute:assign` |
| 合规 | 查看证据链与审计（只读） | `dispute:audit:read`（无处理权） |

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

## 4. 功能需求

### 4.1 功能清单总览

| 模块 | 功能点 | 优先级 | 来源 |
|------|--------|--------|------|
| 入口 | REQ-DSP-01 交易详情「对此交易有异议」入口 | 必须 | 诉求单 CR-2026-1004 |
| 申请 | REQ-DSP-02 争议申请与证据上传 | 必须 | 诉求单 CR-2026-1004 |
| 查询 | REQ-DSP-03 我的争议（列表/详情/补充材料/撤案） | 必须 | 诉求单 CR-2026-1004 |
| 后台 | REQ-DSP-04 案件工作台（待办/筛选/状态迁移） | 必须 | 客户服务部 |
| 资金 | REQ-DSP-05 临时入账（审核通过后贷记） | 必须 | 诉求单 CR-2026-1004 |
| 结案 | REQ-DSP-06 chargeback 与结案 | 必须 | 诉求单 CR-2026-1004 |
| 时限 | REQ-DSP-07 时限提醒（受理/chargeback 超时前通知） | 应该 | 合规时限要求（模拟） |

### 4.2 详细功能需求

#### REQ-2026-004-01 交易详情「对此交易有异议」入口（REQ-DSP-01）

**功能描述**：在交易详情页对满足资格的交易展示争议入口；已有进行中争议时展示案件入口与状态；不满足资格时置灰并说明原因。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| transactionId | string(20) | 是 | 20 位数字串，属于当前客户账户 | 无 | 路由路径参数 |
| transactionStatus | string(16) | 是 | 仅 `POSTED` 可争议 | `POSTED` | transaction-service |
| postedDate | date | 是 | 距今 ≤ 90 天 | 交易入账日 | transaction-service |
| disputeEligible | boolean | 是 | true/false，服务端计算 | false | dispute-service 资格字段 |
| existingCaseId | string(32) | 否 | 存在进行中案件时返回 | 空 | dispute-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 交易未入账或已撤销 | 入口隐藏 | `DISPUTE_NOT_ELIGIBLE` | 「该交易当前状态不支持争议」 |
| 交易入账超过 90 天 | 入口置灰 | `DISPUTE_NOT_ELIGIBLE` | 「超过 90 天的交易请致电客服」 |
| 已有进行中争议 | 展示「处理中」徽标并跳转案件详情 | `DISPUTE_EXISTS` | 「该交易已有处理中的争议」 |
| 交易不属于当前客户 | 返回 404，不泄露交易存在性 | 无（`404`） | 「交易不存在」 |
| transaction-service 超时（> 500ms） | 入口展示重试 | `DOWNSTREAM_UNAVAILABLE` | 「争议入口加载失败，请重试」 |

#### REQ-2026-004-02 争议申请与证据上传（REQ-DSP-02）

**功能描述**：客户选择原因码、填写金额与描述、上传证据后提交；系统创建 `OPEN` 案件、保存证据元数据、计算 SLA 到期时间并通知客户与专员。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| transactionId | string(20) | 是 | 存在、`POSTED`、90 天内、无进行中争议 | 无 | 前端选择 |
| accountId | string(20) | 是 | 与交易归属一致 | 交易账户 | 会话上下文 |
| reasonCode | string(24) | 是 | 枚举 `FRAUD`/`UNAUTHORIZED`/`DUPLICATE`/`SERVICE_NOT_RECEIVED`/`OTHER` | 无 | 前端下拉 |
| amount | decimal(12,2) | 是 | > 0，且 ≤ 交易金额，HALF_UP 2 位 | 交易金额 | 前端表单 |
| description | string(500) | 是 | 10–500 字符，去除首尾空格 | 空 | 前端输入 |
| evidenceCount | int | 否 | `FRAUD`/`UNAUTHORIZED` 时 ≥ 1；单个 ≤ 10MB，单案 ≤ 5 个 | 0 | document-service 回执 |
| idempotencyKey | string(64) | 是 | 唯一，重复提交返回同一案件 | 无 | 前端 |
| slaDueAt | timestamptz | 是 | = 提交时间 + 1 个工作日（遇非工作日顺延） | 计算值 | dispute-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 同一交易已有进行中争议 | 拒绝开案，返回已有案件号 | `DISPUTE_EXISTS` | 「该交易已有处理中的争议，请查看进度」 |
| `FRAUD`/`UNAUTHORIZED` 未上传证据 | 拒绝开案 | `EVIDENCE_REQUIRED` | 「欺诈或未授权交易需至少上传 1 份证据」 |
| 争议金额 > 交易金额或 ≤ 0 | 校验失败 | `INVALID_DISPUTE_AMOUNT` | 「争议金额需大于 0 且不超过交易金额」 |
| 证据文件超过 10MB 或类型不符 | 上传阶段拒绝 | `INVALID_EVIDENCE` | 「仅支持 PDF/JPG/PNG，单个文件不超过 10MB」 |
| 单案证据超过 5 个 | 拒绝上传 | `EVIDENCE_LIMIT_EXCEEDED` | 「单个案件最多 5 份证据」 |
| 同一去重键重复提交 | 返回首次创建的案件 | 无（去重命中） | 「争议已提交，正在跳转案件详情」 |
| document-service 不可用 | 案件不创建，提示稍后重试 | `DOWNSTREAM_UNAVAILABLE` | 「证据上传失败，请重试」 |

#### REQ-2026-004-03 临时入账（REQ-DSP-05）

**功能描述**：审核通过后由专员发起临时入账，调用 account-service 按争议金额贷记客户账户；同一案件只入账一次，入账后案件状态置 `PROVISIONAL_CREDIT`，客户可见入账状态与金额。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| caseId | string(32) | 是 | 状态 `UNDER_REVIEW`，存在 | 无 | 路由路径参数 |
| creditAmount | decimal(12,2) | 是 | > 0，且 ≤ 争议金额 | 争议金额 | 专员填写 |
| provisionalCreditId | string(32) | 是 | 唯一，作为 account `creditId` 传入 | 服务端生成 | dispute-service |
| creditReason | string(32) | 是 | 固定 `DISPUTE_PROVISIONAL` | `DISPUTE_PROVISIONAL` | dispute-service |
| approverRequired | boolean | 是 | `creditAmount` > 1000.00 时为 true | false | 规则配置 |
| status | string(16) | 是 | `UNDER_REVIEW` → `PROVISIONAL_CREDIT` | 无 | 状态机 |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 入账金额 > 争议金额 | 拒绝入账 | `PROVISIONAL_CREDIT_EXCEEDS_AMOUNT` | 「临时入账金额不得超过争议金额」 |
| 案件已入账，重复发起 | 返回首次入账结果，不重复加钱 | 无（去重命中） | 「该案件已完成临时入账」 |
| 案件状态非 `UNDER_REVIEW` | 拒绝入账 | `INVALID_DISPUTE_STATE` | 「当前案件状态不支持临时入账」 |
| 金额 > 1000.00 且未获主管审批 | 拒绝入账 | `APPROVAL_REQUIRED` | 「大额临时入账需主管审批」 |
| account-service 贷记失败 | 案件保持 `UNDER_REVIEW`，不写 `provisional_credit_id` | `DOWNSTREAM_UNAVAILABLE` | 「临时入账失败，请重试」 |
| 贷记成功但案件回写失败 | 以 `provisionalCreditId` 去重重放修复，触发告警 | `STATE_SYNC_PENDING` | 「入账已受理」 |

#### REQ-2026-004-04 chargeback 与结案（REQ-DSP-06）

**功能描述**：客户与专员在案件详情查看 chargeback 进度；专员发起 chargeback，收到卡组织结果后结案（`WON`/`LOST`），结案时按结论保留或冲回临时入账并发送通知。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| caseId | string(32) | 是 | 状态允许 chargeback 或结案 | 无 | 路由路径参数 |
| chargebackRef | string(32) | 否 | 发起 chargeback 后回填，唯一 | 空 | dispute-service |
| chargebackAt | timestamptz | 否 | 发起时间，≤ 交易入账日 + 30 天 | 空 | dispute-service |
| won | boolean | 是 | 结案时必填，来自卡组织结果 | 无 | 专员填写 |
| reverseCredit | boolean | 是 | `won=false` 且已临时入账时为 true | 计算值 | 结算规则 |
| status | string(16) | 是 | `CHARGEBACK` → `WON`/`LOST` → `CLOSED` | 无 | 状态机 |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 超过交易入账日 + 30 天发起 chargeback | 拒绝发起，转人工升级 | `CHARGEBACK_WINDOW_EXPIRED` | 「已超过退单时限，将由主管升级处理」 |
| 案件状态不允许结案 | 拒绝结案 | `INVALID_DISPUTE_STATE` | 「当前案件状态不支持结案」 |
| 结案时冲回临时入账失败 | 案件保持 `CHARGEBACK`，进入重试队列 | `DOWNSTREAM_UNAVAILABLE` | 「结案处理中，请稍后查看」 |
| 同一案件重复结案 | 返回首次结案结果 | 无（去重命中） | 「该案件已结案」 |
| 结案结果与临时入账方向冲突（won=true 但要求冲回） | 拒绝操作并提示规则冲突 | `SETTLEMENT_CONFLICT` | 「结案规则冲突，请联系主管」 |

#### REQ-2026-004-05 时限提醒（REQ-DSP-07）

**功能描述**：系统每日 02:00 扫描未结案案件的 SLA，在到期前 24 小时通知专员与主管，超时案件在工作台标记 `sla=breached` 并升级主管。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| caseId | string(32) | 是 | 未结案案件 | 无 | dispute_case |
| slaDueAt | timestamptz | 是 | 受理 1 个工作日或 chargeback 30 天 | 计算值 | dispute-service |
| slaState | string(16) | 是 | 枚举 `ON_TRACK`/`DUE_SOON`/`BREACHED` | `ON_TRACK` | 扫描任务 |
| notifyTargets | array | 是 | 专员 + 主管至少各 1 人 | 案件责任人 | 案件关系表 |
| lastActionAt | timestamptz | 是 | 每次状态迁移刷新 | 创建时间 | dispute-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 案件无责任人 | 指派到默认专员队列并告警 | `OWNER_MISSING` | 后台提示「案件未指派，已入默认队列」 |
| notification-service 不可用 | 记录待补发，下一次扫描重试 | 无（延迟通知） | 后台提示「提醒发送失败，已排队重试」 |
| 案件在扫描期间被结案 | 跳过本案件，不重复提醒 | 无 | 无提示 |
| 扫描任务被中断 | 断点续跑，按 `lastActionAt` 去重 | 无（任务重跑） | 无提示 |

> 说明：未单独展开的 REQ-DSP-03（我的争议）与 REQ-DSP-04（案件工作台）由 4.1 功能清单、第 5 章业务规则与第 9 章场景矩阵覆盖，接口定义见第 7 章。

### 4.3 界面改造清单

| 页面 | 改造 |
|------|------|
| 交易详情 `#/transactions/{id}` | 新增「对此交易有异议」按钮；已争议显示案件入口 |
| 争议申请 `#/disputes/new` | 交易摘要、原因码、金额、描述、证据上传、确认 |
| 我的争议 `#/disputes` | 列表、状态徽标、金额、时限 |
| 争议详情 `#/disputes/{id}` | 时间线、证据列表、补充材料、撤案 |
| 案件工作台 `#/risk/disputes`（管理员） | 待办、筛选、SLA 倒计时、详情 |
| 案件详情 | 交易与客户、证据预览、审核/临时入账/chargeback/结案 |

页面状态：加载中、无资格、证据上传中、审核待办、临时入账中、chargeback 中、已结案、SLA 超时。

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

## 6. 非功能需求

### 6.1 性能、可用性与可观测性

| 维度 | 指标 | 验证方法 |
|------|------|---------|
| 性能 | 开案 p95 < 1200ms；列表 p95 < 800ms；证据上传 10MB 文件 < 10 秒 | 压测 50 并发；上传大文件计时 |
| 可用性 | 依赖失败返回明确错误码，案件状态不变 | 停用 account-service 后发起临时入账，断言案件仍为 `UNDER_REVIEW` |
| 一致性 | 临时入账、结案冲回与账户余额最终一致，差异窗口 ≤ 10 分钟 | 对账脚本比对案件与账户贷记记录 |
| 去重 | 开案、临时入账、结案支持去重，重复请求返回当前状态 | 同一去重键与同一 `provisionalCreditId` 重复提交，断言金额只变更 1 次 |
| 时限 | SLA 扫描每日 02:00 执行，到期前 24 小时提醒 | 构造 23 小时后到期的案件，断言提醒事件 |
| 审计 | 状态迁移、证据、金额变更全量留痕 | 抽查 10 个案件事件序列 |

### 6.2 安全需求

| 维度 | 要求 | 验证方法 |
|------|------|---------|
| 认证 | 全部接口需 IAM 签发的 JWT；无 token 返回 401 | 无 token 调用 10 个接口 |
| 授权 | 客户仅可访问本人案件；证据下载需案件客户或经办人身份 | 用 A 客户 token 下载 B 客户证据，断言 403 |
| 越权防护 | 客户访问非本人案件返回 404，不泄露案件存在性 | 构造跨客户访问请求 |
| 证据安全 | 类型白名单 PDF/JPG/PNG，单文件 ≤ 10MB，单案 ≤ 5 个；下载写审计 | 上传可执行文件与超限文件均被拒 |
| 数据保护 | 日志与响应中的卡号仅后 4 位；描述字段过滤 HTML 与脚本 | 提交含脚本的描述，断言被转义 |
| 审计 | 状态迁移、证据访问、金额变更、结案写审计，留存 3 年 | 查询 audit-service 事件完整性 |

## 7. 接口与集成

| 接口 | 方向 | 说明 |
|------|------|------|
| POST `/api/v1/disputes` | 前端 → dispute-service | 开案（201，带去重键） |
| GET `/api/v1/disputes?accountId=&status=&page=&size=` | 前端 → dispute-service | 我的争议列表 |
| GET `/api/v1/disputes/{id}` | 前端 → dispute-service | 详情与时间线 |
| POST `/api/v1/disputes/{id}/evidence` | 前端 → document-service | 上传证据并回写元数据 |
| POST `/api/v1/disputes/{id}/withdraw` | 前端 → dispute-service | 撤案 |
| GET `/api/v1/admin/disputes?status=&sla=breached&page=&size=` | 后台 → dispute-service | 案件工作台列表 |
| POST `/api/v1/admin/disputes/{id}/review` | 后台 → dispute-service | 受理审核 |
| POST `/api/v1/admin/disputes/{id}/provisional-credit` | 后台 → dispute-service | 临时入账（去重 `creditId`） |
| POST `/api/v1/admin/disputes/{id}/chargeback` | 后台 → dispute-service | 发起 chargeback |
| POST `/api/v1/admin/disputes/{id}/resolve` | 后台 → dispute-service | 结案（`won=true/false`） |
| 交易快照 | dispute-service → transaction-service | 读取交易金额、入账日、状态 |
| 证据存储 | dispute-service → document-service | 文件存取与鉴权下载 |
| 临时入账与冲回 | dispute-service → account-service | `POST /accounts/{id}/credits`，`creditId = provisionalCreditId` |
| 案件通知 | dispute-service → notification-service | 开案、入账、结案、SLA 提醒（失败不回滚） |
| 审计事件 | dispute-service → audit-service | actor/action/resource/payload |

请求示例：

```json
{"transactionId":"0000000000000200","accountId":"00000000006",
 "reasonCode":"FRAUD","amount":299.00,"description":"未授权交易",
 "idempotencyKey":"dsp-20261027-001"}
```

错误码清单：

| 错误码 | HTTP | 触发条件 |
|--------|------|---------|
| `DISPUTE_NOT_ELIGIBLE` | 409 | 交易未入账或超过 90 天 |
| `DISPUTE_EXISTS` | 409 | 同一交易已有进行中案件 |
| `EVIDENCE_REQUIRED` | 409 | FRAUD/UNAUTHORIZED 未上传证据 |
| `INVALID_EVIDENCE` | 400 | 类型或大小不符合白名单 |
| `EVIDENCE_LIMIT_EXCEEDED` | 400 | 单案证据超过 5 个 |
| `INVALID_DISPUTE_AMOUNT` | 400 | 金额 ≤ 0 或超过交易金额 |
| `INVALID_DISPUTE_STATE` | 409 | 当前状态不支持该操作 |
| `PROVISIONAL_CREDIT_EXCEEDS_AMOUNT` | 409 | 临时入账金额超过争议金额 |
| `APPROVAL_REQUIRED` | 403 | 大额入账缺主管审批 |
| `CHARGEBACK_WINDOW_EXPIRED` | 409 | 超过 30 天退单窗 |
| `SETTLEMENT_CONFLICT` | 409 | 结案规则冲突 |
| `DOWNSTREAM_UNAVAILABLE` | 503 | transaction/document/account 依赖失败 |

## 8. 数据需求

### 8.1 数据字典

**表 `dispute_case`（复用并扩展）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| case_id | 案件号 | varchar(32) 主键 | dispute-service 生成 |
| transaction_id | 关联交易号 | varchar(20) 非空，索引 | 交易快照 |
| account_id | 账户号 | varchar(20) 非空，索引 | 请求体 |
| customer_id | 客户号 | varchar(20) 非空 | customer-service |
| reason_code | 原因码 | varchar(24)，5 个枚举值 | 前端下拉 |
| amount | 争议金额 | numeric(12,2) > 0 且 ≤ 交易金额 | 前端表单 |
| description | 争议描述 | varchar(500) 非空 | 前端输入 |
| status | 案件状态 | varchar(16)，7 个枚举值 | 状态机 |
| sla_due_at | SLA 到期时间 | timestamptz 非空 | 计算值 |
| last_action_at | 最近动作时间 | timestamptz 非空 | 状态迁移刷新 |
| provisional_credit_id | 临时入账标识 | varchar(32) 可空，唯一 | dispute-service |
| chargeback_at | chargeback 发起时间 | timestamptz 可空 | 专员操作 |
| idempotency_key | 去重键 | varchar(64) 唯一索引 | 前端 |
| version | 乐观锁版本 | int 默认 0 | 服务端 |

**表 `dispute_evidence`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| evidence_id | 证据编号 | varchar(32) 主键 | dispute-service 生成 |
| case_id | 所属案件 | varchar(32) 外键 | dispute_case |
| document_id | 文件标识 | varchar(32) 非空，联合唯一 `(case_id, document_id)` | document-service |
| file_name | 原始文件名 | varchar(128) 非空 | 上传请求 |
| content_type | 文件类型 | varchar(32)，`application/pdf`/`image/jpeg`/`image/png` | 上传请求 |
| uploaded_by | 上传人 | varchar(64) 非空 | IAM token |
| uploaded_at | 上传时间 | timestamptz 非空 | 服务端 |

**表 `dispute_event`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| event_id | 事件编号 | varchar(32) 主键 | dispute-service 生成 |
| case_id | 所属案件 | varchar(32) 外键，索引 | dispute_case |
| event_type | 事件类型 | varchar(32)，`SUBMIT`/`REVIEW`/`CREDIT`/`CHARGEBACK`/`RESOLVE`/`EVIDENCE_VIEW` | 业务动作 |
| from_status / to_status | 迁移前后状态 | varchar(16) 可空 | 状态机 |
| actor | 操作人 | varchar(64) 非空 | IAM token |
| payload | 事件内容 | jsonb，敏感字段脱敏 | 服务端 |
| created_at | 事件时间 | timestamptz 非空 | 服务端 |

### 8.2 数据安全

| 维度 | 要求 |
|------|------|
| 脱敏 | 客户姓名按「姓 + \*」展示；卡号仅后 4 位；证据文件名在列表中截断展示，下载需鉴权 |
| 加密 | 证据文件由 document-service 加密存储（AES-256）；本服务仅存元数据；传输层 HTTPS |
| 留存 | 案件与证据留存 7 年（模拟制度）；审计事件留存 3 年；超期证据由 document-service 归档 |
| 访问 | 客户仅可访问本人案件证据；专员可访问受理案件；主管可访问全部；每次下载写审计事件 |
| 最小化 | 不采集客户身份证影像；描述字段过滤 HTML 与脚本，长度上限 500 字符 |

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | 90 天内已入账交易提交 FRAUD 争议并上传 1 份 PDF | 持卡人 | POST `/disputes` + `/evidence` | 201，案件 `OPEN`，`sla_due_at` = 提交时间 + 1 个工作日，客户可见时间线 |
| 主流程 | 专员审核通过并发起临时入账 299.00 | 争议专员 | POST `/admin/disputes/{id}/review` + `/provisional-credit` | 案件 `PROVISIONAL_CREDIT`，账户贷记 299.00，客户可见入账状态 |
| 主流程 | chargeback 胜诉结案 | 争议专员 | POST `/admin/disputes/{id}/chargeback` + `/resolve`（`won=true`） | 案件 `WON` 后 `CLOSED`，保留临时入账，通知已发 |
| 边界 | 交易入账日距今天 90 天整 | 持卡人 | POST `/disputes` | 201，允许开案 |
| 边界 | 交易入账日距今天 91 天 | 持卡人 | POST `/disputes` | 409 `DISPUTE_NOT_ELIGIBLE` |
| 边界 | 临时入账金额 = 争议金额 | 争议专员 | POST `/provisional-credit`，`creditAmount` = `amount` | 200，入账成功 |
| 边界 | 单案上传第 5 份证据 | 持卡人 | POST `/disputes/{id}/evidence` | 200，证据数达到上限 |
| 异常 | 同一交易第 2 次开案 | 持卡人 | POST `/disputes` | 409 `DISPUTE_EXISTS` |
| 异常 | FRAUD 原因未上传证据 | 持卡人 | POST `/disputes` | 409 `EVIDENCE_REQUIRED` |
| 异常 | 临时入账重复提交 2 次 | 争议专员 | POST `/provisional-credit`，`provisionalCreditId` 固定 | 账户只贷记 1 次，第 2 次返回首次结果 |
| 异常 | 临时入账金额 300.00 而争议金额 299.00 | 争议专员 | POST `/provisional-credit` | 409 `PROVISIONAL_CREDIT_EXCEEDS_AMOUNT` |
| 异常 | 第 31 天发起 chargeback | 争议专员 | POST `/chargeback` | 409 `CHARGEBACK_WINDOW_EXPIRED` |
| 时限 | 案件距 SLA 到期 23 小时 | 系统扫描 | 每日 02:00 扫描任务 | 专员与主管收到提醒，`slaState=DUE_SOON` |
| 权限 | 客户 A 下载客户 B 的证据 | 持卡人 | GET 证据下载地址 | 403，无文件内容返回，审计记录拒绝 |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 90 天内已入账交易 299.00，无进行中争议 | 提交 FRAUD 争议并上传 1 份 PDF | 案件 `OPEN`，客户可查看时间线与 SLA 到期时间 | 交易 0000000000000200，账户 00000000006 |
| US-002 | 同一交易已有 `OPEN` 案件 | 再次开案 | 409 `DISPUTE_EXISTS`，案件数不变 | 复用 US-001 数据 |
| US-003 | 交易尚未上传证据 | 提交 FRAUD 争议 | 409 `EVIDENCE_REQUIRED` | 复用 US-001 数据 |
| US-004 | 案件 `UNDER_REVIEW` | 临时入账 100.00 并重复提交 | 账户贷记 100.00 一次，案件 `PROVISIONAL_CREDIT` | 案件号 + 账户余额初始值 |
| US-005 | 案件已临时入账 | 发起 chargeback 并结案 `won=true` | 状态 `WON` 后 `CLOSED`，客户收到通知，审计完整 | 复用 US-004 数据 |
| US-006 | 案件距 SLA 到期 23 小时 | 执行每日 02:00 扫描 | 专员与主管收到提醒，`slaState=DUE_SOON` | 调整 `sla_due_at` 数据 |
| US-007 | 交易入账 91 天前 | 打开交易详情 | 入口置灰，提示「超过 90 天的交易请致电客服」 | 交易 0000000000000199 |
| US-008 | account-service 停用 | 发起临时入账 299.00 | 503 `DOWNSTREAM_UNAVAILABLE`，案件保持 `UNDER_REVIEW`，余额不变 | 停用容器 |

## 11. 依赖与约束

### 11.1 依赖

| 依赖对象 | 用途 | 失败影响与处理 |
|---------|------|---------------|
| transaction-service | 交易快照与资格 | 入口展示重试，不创建案件 |
| document-service | 证据存储与鉴权下载 | 开案失败或证据缺失，提示重试 |
| account-service | 临时入账与结案冲回 | 案件状态不变，进入重试队列 |
| notification-service | 开案、入账、结案、SLA 提醒 | 主流程不回滚，记录待补发 |
| audit-service | 审计事件 | 写失败进入本地补偿日志 |
| fraud-service | 欺诈线索（本期仅预留） | 不阻塞主流程 |
| IAM | 认证、角色与主管审批主体 | 无 token 返回 401 |

### 11.2 影响分析

| 维度 | 影响 |
|------|------|
| 前台 | 交易详情、争议申请、我的争议、争议详情、后台工作台、案件详情 |
| 后台 | dispute 状态机与 SLA；document 证据；account 临时入账；transaction 交易快照；notification 通知；audit 审计 |
| 数据 | `dispute_case` 增字段；`dispute_evidence`、`dispute_event` 新增 |
| 接口 | 10 个新接口与扩展接口；交易响应增加争议状态字段 |
| 配置 | 证据大小与类型、SLA 规则、大额入账阈值 1000.00、通知模板 |
| 测试 | 资格、唯一案件、证据必填、临时入账去重与超限、状态迁移、SLA、越权 |
| 文档 | 本需求、API 目录、争议处理 runbook、SLA 说明 |

### 11.3 约束

- 复用现有 dispute-service 与 `dispute_case`，不新建争议服务。
- 证据文件由 document-service 管理，本服务只存元数据。
- 金额统一 `BigDecimal` / `numeric(12,2)`。
- 所有写接口支持去重键；临时入账与结案必须支持去重（`creditId` 与案件状态双重校验）。
- 演示环境沿用 IAM 角色 `U`/`A`，POC 不做接口级强鉴权（ADR-007），但案件归属校验必须保留。

## 12. 风险与假设

### 12.1 风险与应对

| 风险/假设 | 影响 | 应对 |
|-----------|------|------|
| 90 天争议窗与 SLA 时限为模拟值，未按卡组织规则确认 | 案件拒付失败或超时 | 时限全部配置化；上线前与卡组织规则比对并出具对照表 |
| 临时入账会计科目与冲回策略未与财务对齐 | 账务挂账错误 | 默认贷记客户可用额度，科目配置化；每日对账 |
| 证据保留 7 年带来存储成本 | 存储增长 | document-service 冷热分层，超 1 年转低频存储 |
| 主管审批依赖人工在场 | 大额入账延迟 | 金额 > 1000.00 时通知双人，超 4 小时未审批升级 |
| 假设单案证据 ≤ 5 个 | 复杂案件证据不足 | 上限配置化，主管可临时调至 10 个 |
| SLA 扫描任务单点失败 | 提醒遗漏 | 任务重跑机制 + 扫描结果对账 |

### 12.2 假设

- 卡组织结果由专员人工录入，本期不做报文直连。
- 客户撤案后不可重新开启同一案件，需重新开案（受 90 天窗限制）。

### 12.3 待确认事项

1. 90 天争议窗口与 SLA 时限（待确认：按卡组织规则与行内制度确认，当前为模拟值）。
2. 临时入账的会计科目与冲回策略（待确认：财务确认科目与冲回触发条件）。
3. 证据保留期限与隐私合规（待确认：法务确认 7 年留存与归档方式）。
4. 与 fraud-service 的欺诈案件联动范围（待确认：本期仅预留线索字段）。
5. 大额临时入账阈值 1000.00（待确认：主管审批范围）。

## 13. 合规标注

| 维度 | 标注 |
|------|------|
| 监管（模拟） | 参照《商业银行信用卡业务监督管理办法》关于客户投诉与差错处理的时限要求，以及卡组织争议时限规则：受理 1 个工作日、chargeback 30 天。本文件为演示材料，不构成监管合规结论。 |
| 制度（模拟） | 参照行内争议与差错处理办法（模拟编号 DISP-POLICY-2026）：受理须留痕，证据须可追溯，结案须有结论依据。 |
| SoD（职责分离） | 专员不可自行审批大额临时入账（需主管）；结案结论录入人与复核人分离；合规角色只读。 |
| 隐私（模拟） | 参照《个人信息保护法》，证据仅采集争议必需材料，访问留痕，留存期届满归档删除。 |
| 审计 | 状态迁移、证据访问、金额变更、结案全量留痕，审计留存 3 年。 |
| 结论 | 模拟需求，时限与阈值为演示假设，投产前需法务、合规、财务三方会签。 |

---

## 附录 A 章节编号对照（检查脚本兼容）

| 旧版脚本章节 | 本文件章节 | 脚本匹配标题 |
|-------------|-----------|-------------|
| 10. 风险与应对 | 12. 风险与假设 | `## 10. 风险与应对` |
| 11. 合规标注 | 13. 合规标注 | `## 11. 合规标注` |
