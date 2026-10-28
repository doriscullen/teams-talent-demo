# REQ-2026-003 信用卡额度调整申请与审批 需求说明书

> 深度标记：L3（涉及授信/审批/SoD）——字段级需求表、异常矩阵、数据字典、场景矩阵为必填项。

## 文档信息

| 项 | 内容 |
|----|------|
| 文档编号 | REQ-2026-003 |
| 版本 | v1.0（模拟） |
| 业务负责人 | 风险管理部 授信产品负责人（模拟角色：Product Owner, Risk Management） |
| 需求来源 | 风险管理部诉求单 CR-2026-1003「提额线上化与审批分离」（模拟工单） |
| 档位 | L3（涉及授信/审批/SoD） |
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

客户提额目前只能由客服线下受理，缺少申请入口、审批工作台和进度反馈；额度变更与审批职责也未完全分离，审批依据分散在工单与邮件中。
本期提供客户自助申请、系统预审、人工审批、额度实时生效与全程审计。

### 1.2 业务目标（可量化）

| 目标 | 量化指标 |
|------|---------|
| 申请线上化 | 提额申请线上化率 100%（线下受理入口在 R2 上线后关闭） |
| 缩短审批时长 | 从申请到额度生效平均时长由 3 天降至 4 小时 |
| 控制风险 | 越权审批与超限审批事件 0 起（按季度审计统计） |
| 提升体验 | 提交 p95 < 1200ms；审批列表 p95 < 800ms |

### 1.3 术语表

| 术语 | 定义 |
|------|------|
| 永久额度 | 长期生效的信用额度，本期仅支持该类型 |
| 系统预审 | 提交时按逾期、用卡时长、提额次数、产品上限自动校验 |
| 初审 | 人工核对资料与资格并给出建议的环节 |
| 终审 | 审批人做出批准或拒绝决策并设定新额度的环节 |
| SoD | 职责分离，要求申请人与审批人、初审人与终审人不为同一人 |
| 去重键 | 客户端生成的业务唯一键（接口字段 `idempotencyKey`），同一键重复提交返回同一结果 |

## 2. 用户角色与权限

| 角色 | 职责 | 权限点 |
|------|------|--------|
| 持卡人 | 提交提额申请、补充材料、查看进度 | `limit:apply:self`、`limit:read:self`、`document:upload:self` |
| 初审 | 校验资料与资格，给出初审建议 | `limit:review`、`limit:read:any` |
| 审批人 | 批准或拒绝申请、设定新额度 | `limit:approve`、`limit:read:any` |
| 风控/合规 | 查看规则命中与审计（只读） | `limit:read:any`、`limit:audit:read`（无审批权） |

## 3. 范围定义

### 3.1 In-Scope / Out-of-Scope

**In-Scope**

- 永久额度申请（客户发起）。
- 客户申请、资料补充、进度查询。
- 系统预审：逾期、用卡时长、近 6 个月提额次数、产品上限。
- 工作流审批（初审→终审）、额度更新、通知、审计。
- 前台账户页提额入口、申请页、进度页；后台审批工作台。

**Out-of-Scope**

- 自动提额（系统主动发起）。
- 降额、临时额度到期恢复。
- 收入证明 OCR 与外部征信接口接入。

### 3.2 假设与依赖

| 编号 | 假设/依赖 | 说明 |
|------|----------|------|
| A-01 | account-service 提供额度读取与更新接口 | 本期沿用 `PUT /accounts/{id}` |
| A-02 | limit-service 维护限额定义与产品最大额度 | 预审规则上限取自该服务 |
| A-03 | workflow-service 提供审批任务与待办列表 | 初审与终审作为两个任务节点 |
| A-04 | document-service 存储收入材料并返回 `documentId` | 本需求只保存引用 |
| A-05 | 逾期数据由账单或催收服务提供 | 预审阶段调用只读接口 |

## 4. 功能需求

### 4.1 功能清单总览

| 模块 | 功能点 | 优先级 | 来源 |
|------|--------|--------|------|
| 入口 | REQ-LIM-01 账户页「申请提额」入口 | 必须 | 诉求单 CR-2026-1003 |
| 申请 | REQ-LIM-02 提额申请表单与提交 | 必须 | 诉求单 CR-2026-1003 |
| 预审 | REQ-LIM-03 系统预审（逾期/用卡时长/次数/上限） | 必须 | 风险政策（模拟） |
| 进度 | REQ-LIM-04 申请进度时间线 | 必须 | 诉求单 CR-2026-1003 |
| 审批 | REQ-LIM-05 审批工作台（初审→终审） | 必须 | 风险管理部 |
| 生效 | REQ-LIM-06 额度实时生效与通知 | 必须 | 诉求单 CR-2026-1003 |
| 合规 | REQ-LIM-07 审计与 SoD 校验 | 必须 | 模拟合规要求 |

### 4.2 详细功能需求

#### REQ-2026-003-01 账户页「申请提额」入口（REQ-LIM-01）

**功能描述**：在账户视图展示当前额度与提额按钮；账户为 `ACTIVE` 且无进行中申请时按钮可用，存在进行中申请时展示申请状态与入口链接。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| accountId | string(20) | 是 | 20 位数字串，属于当前登录客户 | 无 | 路由路径参数 |
| accountStatus | string(16) | 是 | 仅 `ACTIVE` 展示可用按钮 | `ACTIVE` | account-service |
| creditLimit | decimal(12,2) | 是 | > 0，HALF_UP 2 位 | 账户当前额度 | account-service |
| productMaxLimit | decimal(12,2) | 是 | ≥ `creditLimit`，取自产品配置 | 产品最大额度 | limit-service |
| pendingApplicationId | string(32) | 否 | 存在进行中申请时返回 | 空 | limit-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 账户非 `ACTIVE`（冻结/销户） | 按钮隐藏 | `LIMIT_NOT_ELIGIBLE` | 「当前账户状态不支持提额」 |
| 已存在进行中申请 | 按钮置灰，展示「查看进度」链接 | `LIMIT_APPLICATION_EXISTS` | 「您有一笔提额申请正在处理中」 |
| 当前额度已达产品最大额度 | 按钮置灰 | `LIMIT_REACHED_PRODUCT_MAX` | 「当前额度已达产品上限」 |
| account-service 超时（> 500ms） | 额度卡片展示重试 | `DOWNSTREAM_UNAVAILABLE` | 「额度信息加载失败，请重试」 |

#### REQ-2026-003-02 提额申请表单与提交（REQ-LIM-02）

**功能描述**：客户填写期望额度、用途、收入区间并按需上传材料后提交；提交即触发系统预审，申请状态置为 `SUBMITTED`，并生成审批任务。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| accountId | string(20) | 是 | 归属当前客户 | 当前账户 | 会话上下文 |
| requestedLimit | decimal(12,2) | 是 | > 当前额度，且 ≤ 产品最大额度，HALF_UP 2 位 | 无 | 前端表单 |
| purpose | string(16) | 是 | 枚举 `TRAVEL`/`EDUCATION`/`MEDICAL`/`DAILY`/`BUSINESS` | `DAILY` | 前端下拉 |
| incomeRange | string(16) | 是 | 枚举 `0-10K`/`10K-20K`/`20K-30K`/`30K-50K`/`50K+` | 空 | 前端下拉 |
| documents | array | 否 | 期望额度 > 当前额度 2 倍时必填，至少 1 个 `documentId` | 空 | document-service |
| idempotencyKey | string(64) | 是 | 客户端生成，唯一，30 分钟内重复提交返回同一申请 | 无 | 前端 |
| status | string(16) | 是 | 初始 `SUBMITTED` | `SUBMITTED` | limit-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 期望额度 ≤ 当前额度 | 表单校验失败，提交被拒 | `INVALID_REQUESTED_LIMIT` | 「期望额度需高于当前额度」 |
| 期望额度 > 产品最大额度 | 提交被拒 | `LIMIT_EXCEEDS_PRODUCT_MAX` | 「期望额度不得超过产品上限 X 元」 |
| 已有进行中申请 | 提交被拒 | `LIMIT_APPLICATION_EXISTS` | 「您有一笔提额申请正在处理中」 |
| 期望额度 > 当前额度 2 倍且未上传材料 | 提交被拒 | `DOCUMENT_REQUIRED` | 「请上传收入证明材料」 |
| 材料文件超过 5MB 或类型不符 | 上传阶段拒绝 | `INVALID_DOCUMENT` | 「仅支持 PDF/JPG/PNG，单个文件不超过 5MB」 |
| 同一去重键重复提交 | 返回首次创建的申请 | 无（去重命中） | 「申请已提交，正在跳转进度页」 |
| 预审服务超时 | 申请保存为 `SUBMITTED`，预审异步重试 | `PRE_REVIEW_PENDING` | 「申请已受理，预审结果稍后展示」 |

#### REQ-2026-003-03 系统预审（REQ-LIM-03）

**功能描述**：提交后立即执行四项规则校验（近 6 个月逾期、开卡时长、提额次数、产品上限）；全部通过置 `PRE_REVIEWED` 并进入初审，未通过置 `REJECTED` 并展示具体原因。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| overdueMonths6 | int | 是 | 近 6 个月逾期月数，必须为 0 才通过 | 0 | 账单/催收只读接口 |
| cardAgeMonths | int | 是 | 开卡月数，必须 ≥ 3 | 计算值 | card-service |
| increaseCount6m | int | 是 | 近 6 个月成功提额次数，必须为 0 | 0 | limit-service |
| productMaxLimit | decimal(12,2) | 是 | `requestedLimit` ≤ 该值 | 产品配置 | limit-service |
| preReviewResult | string(16) | 是 | 枚举 `PASSED`/`FAILED` | `PENDING` | limit-service |
| preReviewNote | string(128) | 否 | 失败时必填，记录首个命中规则编号 | 空 | limit-service |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 近 6 个月存在逾期 | 置 `REJECTED`，记录 BR-LIM-02 | `LIMIT_NOT_ELIGIBLE` | 「近 6 个月存在逾期记录，本期无法提额」 |
| 开卡不足 3 个月 | 置 `REJECTED`，记录 BR-LIM-03 | `LIMIT_NOT_ELIGIBLE` | 「开卡满 3 个月后可申请提额」 |
| 近 6 个月已成功提额 1 次 | 置 `REJECTED`，记录 BR-LIM-04 | `LIMIT_NOT_ELIGIBLE` | 「近 6 个月已提额一次，请 6 个月后再申请」 |
| 期望额度超过产品上限 | 置 `REJECTED` | `LIMIT_EXCEEDS_PRODUCT_MAX` | 「期望额度超过产品上限」 |
| 逾期或开卡数据源不可用 | 预审置 `PENDING` 并重试 3 次，超限转人工 | `PRE_REVIEW_PENDING` | 「预审处理中，预计 10 分钟内出结果」 |

#### REQ-2026-003-04 审批工作台与 SoD（REQ-LIM-05）

**功能描述**：初审与审批人在工作台处理待办：查看客户信息、当前与期望额度、用卡与逾期、历史提额、材料；初审给出建议，终审批准或拒绝。系统强制申请人≠审批人、初审人≠终审人。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| applicationId | string(32) | 是 | 存在且状态为 `PRE_REVIEWED` 或 `REVIEWED` | 无 | 路由路径参数 |
| approvedLimit | decimal(12,2) | 是 | > 当前额度且 ≤ `requestedLimit` | `requestedLimit` | 审批人填写 |
| decisionNote | string(256) | 是 | 拒绝时必填，长度 10–256 | 空 | 审批人填写 |
| reviewer / approver | string(64) | 是 | 取自 token，不得与 `applicant` 相同 | 无 | IAM token |
| dualApprovalRequired | boolean | 是 | `requestedLimit` > 当前额度 2 倍时为 true | false | limit-service 规则 |
| secondApprover | string(64) | 否 | `dualApprovalRequired` 为 true 时必填且不同于 `approver` | 空 | IAM token |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| 审批人 = 申请人 | 拒绝操作 | `SOD_VIOLATION`（403） | 「不得审批本人提交的申请」 |
| 终审人 = 初审人 | 拒绝操作 | `SOD_VIOLATION`（403） | 「终审人不得与初审人相同」 |
| 申请状态非待审（已批准/已拒绝） | 拒绝操作 | `APPLICATION_NOT_PENDING` | 「该申请已处理完成」 |
| 拒绝时未填原因 | 校验失败 | `DECISION_NOTE_REQUIRED` | 「拒绝必须填写原因」 |
| 需双人审批但第二审批人为空 | 拒绝操作 | `DUAL_APPROVAL_REQUIRED` | 「该额度需双人审批」 |
| 同一审批操作重复提交 | 返回当前状态 | 无（去重命中） | 「该申请已处理」 |

#### REQ-2026-003-05 额度实时生效（REQ-LIM-06）

**功能描述**：终审通过后调用 account-service 更新 `creditLimit`，同步 limit-service 限额定义，状态置 `APPROVED` 并发送通知；额度更新失败时申请保持 `APPROVED_PENDING` 并可重试，不重复审批。

**字段级需求表**：

| 字段 | 类型 | 必填 | 格式/校验 | 默认值 | 来源 |
|------|------|------|----------|--------|------|
| applicationId | string(32) | 是 | 状态为 `APPROVED_PENDING` 或审批通过时刻 | 无 | 请求 |
| newCreditLimit | decimal(12,2) | 是 | = `approvedLimit`，> 0 | `approvedLimit` | limit-service |
| effectiveAt | timestamptz | 是 | 更新成功时刻，不得早于 `decidedAt` | 当前时间 | account-service |
| status | string(16) | 是 | `APPROVED_PENDING` → `APPROVED` | `APPROVED_PENDING` | 状态机 |
| notificationStatus | string(16) | 是 | 枚举 `SENT`/`FAILED` | `SENT` | notification-service 回执 |

**异常矩阵**：

| 异常场景 | 系统行为 | 错误码 | 用户提示 |
|---------|---------|--------|---------|
| account-service 更新失败 | 状态保留 `APPROVED_PENDING`，进入重试队列（5 分钟间隔，最多 6 次） | `CREDIT_LIMIT_UPDATE_FAILED` | 「审批已通过，额度生效处理中」 |
| limit-service 限额同步失败 | 回滚本次额度更新，状态保持 `APPROVED_PENDING` | `CREDIT_LIMIT_UPDATE_FAILED` | 「审批已通过，额度生效处理中」 |
| 期后额度更新成功但通知失败 | 状态置 `APPROVED`，通知失败待补发 | 无（主流程成功） | 「额度已生效」 |
| 重试 6 次仍失败 | 标记 `APPROVED_PENDING` 并转人工工单 | `CREDIT_LIMIT_UPDATE_FAILED` | 「额度生效需人工处理，客服将联系您」 |

> 说明：未单独展开的 REQ-LIM-04（申请进度时间线）与 REQ-LIM-07（审计与 SoD）由 4.1 功能清单、第 5 章业务规则与第 9 章场景矩阵覆盖，接口定义见第 7 章。

### 4.3 界面改造清单

| 页面 | 改造 |
|------|------|
| 账户视图 `#/accounts` | 额度卡片新增「申请提额」按钮；展示进行中申请状态 |
| 提额申请 `#/limits/apply` | 当前额度、期望额度输入、用途、收入区间、附件上传 |
| 申请进度 `#/limits/applications/{id}` | 时间线、预审结果、拒绝原因、客服入口 |
| 审批工作台 `#/risk/limit-approvals`（管理员） | 待办列表、筛选、详情、通过/拒绝、备注 |
| 审批详情 | 客户信息、当前与期望额度、用卡与逾期、历史提额、材料预览 |

页面状态：加载中、无资格、预审处理中、初审待办、终审待办、生效中、已生效、已拒绝。

## 5. 业务规则

| 编号 | 规则 | 来源 | 优先级 | 验证点 |
|------|------|------|--------|--------|
| BR-LIM-01 | 申请额度必须 > 当前额度且 ≤ 产品最大额度 | 模拟风险政策 | 必须 | 8000→8000 被拒；8000→25000 通过；8000→25000.01 返回 `LIMIT_EXCEEDS_PRODUCT_MAX` |
| BR-LIM-02 | 近 6 个月有逾期或最低还款未清不得提额 | 模拟风险政策 | 必须 | 构造 1 个月逾期数据，预审置 `REJECTED` 且 `preReviewNote` 含 BR-LIM-02 |
| BR-LIM-03 | 开卡不足 3 个月不得提额 | 模拟风险政策 | 必须 | 开卡 2 个月申请被拒，提示开卡满 3 个月后可申请 |
| BR-LIM-04 | 同一账户 6 个月内最多 1 次成功提额；进行中申请只能 1 个 | 模拟风险政策 | 必须 | 第 2 次申请返回 `LIMIT_NOT_ELIGIBLE`；并发提交只落 1 条申请 |
| BR-LIM-05 | 申请额度 > 当前额度 2 倍时，必须补充收入材料并双人审批 | 模拟风险政策 | 必须 | 8000→20000.01 无材料被拒；有材料时 `dualApprovalRequired=true` |
| BR-LIM-06 | 审批人不能是申请人或初审人（SoD） | 模拟合规 | 必须 | 同一账号担任两个角色时返回 403 `SOD_VIOLATION` |
| BR-LIM-07 | 审批通过后额度实时生效；拒绝必须填原因 | 模拟风险政策 | 必须 | 通过后 5 秒内 account 额度 = `approvedLimit`；拒绝无原因返回 `DECISION_NOTE_REQUIRED` |
| BR-LIM-08 | 额度更新失败时申请保持 `APPROVED_PENDING`，可重试 | 模拟风险政策 | 必须 | 停用 account-service 后审批，状态为 `APPROVED_PENDING`，恢复后自动生效 |

## 6. 非功能需求

### 6.1 性能、可用性与可观测性

| 维度 | 指标 | 验证方法 |
|------|------|---------|
| 性能 | 提交 p95 < 1200ms；审批列表 p95 < 800ms；额度生效 ≤ 5 秒 | 压测 50 并发；审批后轮询账户额度计时 |
| 可用性 | 额度更新失败可重试且不重复审批 | 停用 account-service 后审批，恢复后自动生效 |
| 一致性 | 审批状态与账户额度最终一致，差异窗口 ≤ 10 分钟 | 对账脚本比对 `limit_application` 与账户额度 |
| 去重 | 提交与审批操作支持去重，重复请求返回当前状态 | 同一去重键提交 3 次，断言申请数为 1 |
| 审计 | 提交、预审、初审、终审、额度变更、通知结果全量留痕 | 查询 audit-service 事件序列 |
| 可观测性 | 关键节点输出 traceId 与 `applicationId`；预审失败计数告警 | 查看指标与告警规则 |

### 6.2 安全需求

| 维度 | 要求 | 验证方法 |
|------|------|---------|
| 认证 | 全部接口需 IAM 签发的 JWT；无 token 返回 401 | 无 token 调用 8 个接口 |
| 授权 | 客户仅可读写本人申请；审批接口仅 `A` 角色且具备 `limit:approve` | 用客户 token 调用审批接口，断言 403 |
| 身份不可伪造 | 申请人、初审人、审批人身份从 token 与网关注入，禁止前端传递 | 构造伪造 `applicant` 字段请求，断言被忽略 |
| SoD | 申请人≠审批人、初审人≠终审人；违规返回 403 | 单账号双角色操作两次，断言均被拒 |
| 数据保护 | 收入区间与材料仅授权角色可见；日志不打印材料内容与文件路径 | 日志检索 `documentId` 之外的材料信息 |
| 材料安全 | 类型白名单 PDF/JPG/PNG，单文件 ≤ 5MB；下载需鉴权且写审计 | 上传 exe 与 6MB 文件均被拒 |
| 审计 | 全部决策与额度变更留痕，留存 3 年 | 抽查 10 笔申请的事件完整性 |

## 7. 接口与集成

| 接口 | 方向 | 说明 |
|------|------|------|
| POST `/api/v1/limit-applications` | 前端 → limit-service | 提交申请（201，带去重键） |
| GET `/api/v1/limit-applications?accountId=&status=` | 前端 → limit-service | 客户与账户申请列表 |
| GET `/api/v1/limit-applications/{id}` | 前端 → limit-service | 详情与进度 |
| POST `/api/v1/limit-applications/{id}/documents` | 前端 → document-service | 补充材料，返回 `documentId` |
| GET `/api/v1/admin/limit-applications?status=&page=&size=` | 后台 → limit-service | 审批待办列表 |
| POST `/api/v1/admin/limit-applications/{id}/review` | 后台 → limit-service | 初审通过或拒绝 |
| POST `/api/v1/admin/limit-applications/{id}/approve` | 后台 → limit-service | 终审通过并更新额度 |
| POST `/api/v1/admin/limit-applications/{id}/reject` | 后台 → limit-service | 拒绝（原因必填） |
| 审批任务 | limit-service → workflow-service | 创建初审与终审任务节点 |
| 额度更新 | limit-service → account-service | `PUT /accounts/{id}` 更新 `creditLimit` |
| 限额定义同步 | limit-service → limit 限额表 | 更新账户限额定义 |
| 提额通知 | limit-service → notification-service | 提交、审批结果通知（失败不回滚） |
| 审计事件 | limit-service → audit-service | actor/action/resource/payload |

请求示例：

```json
{"accountId":"00000000006","requestedLimit":12000.00,
 "purpose":"TRAVEL","incomeRange":"20K-30K",
 "idempotencyKey":"lim-20261027-001"}
```

错误码清单：

| 错误码 | HTTP | 触发条件 |
|--------|------|---------|
| `LIMIT_APPLICATION_EXISTS` | 409 | 已有进行中申请 |
| `LIMIT_NOT_ELIGIBLE` | 409 | 逾期、开卡时长不足、次数超限 |
| `LIMIT_EXCEEDS_PRODUCT_MAX` | 409 | 期望额度超过产品上限 |
| `LIMIT_REACHED_PRODUCT_MAX` | 409 | 当前额度已达产品上限 |
| `INVALID_REQUESTED_LIMIT` | 400 | 期望额度 ≤ 当前额度 |
| `DOCUMENT_REQUIRED` | 400 | 超过 2 倍额度未上传材料 |
| `INVALID_DOCUMENT` | 400 | 类型或大小不符合白名单 |
| `APPLICATION_NOT_PENDING` | 409 | 申请状态非待审 |
| `DECISION_NOTE_REQUIRED` | 400 | 拒绝未填原因 |
| `DUAL_APPROVAL_REQUIRED` | 409 | 需双人审批但缺失第二审批人 |
| `SOD_VIOLATION` | 403 | 违反职责分离 |
| `CREDIT_LIMIT_UPDATE_FAILED` | 503 | 额度更新或限额同步失败 |
| `DOWNSTREAM_UNAVAILABLE` | 503 | account/limit/workflow 依赖失败 |

## 8. 数据需求

### 8.1 数据字典

**表 `limit_application`（新增）**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| application_id | 申请编号 | varchar(32) 主键 | limit-service 生成 |
| account_id | 账户号 | varchar(20) 非空，索引 | 请求体/会话 |
| customer_id | 客户号 | varchar(20) 非空 | customer-service |
| current_limit | 申请时当前额度 | numeric(12,2) > 0 | account-service 快照 |
| requested_limit | 期望额度 | numeric(12,2) > `current_limit` | 前端表单 |
| approved_limit | 批准额度 | numeric(12,2) 可空，≤ `requested_limit` | 审批人填写 |
| purpose | 用途 | varchar(16)，5 个枚举值 | 前端下拉 |
| income_range | 收入区间 | varchar(16)，5 个枚举值 | 前端下拉 |
| status | 申请状态 | varchar(16)，`SUBMITTED`/`PRE_REVIEWED`/`REVIEWED`/`APPROVED`/`APPROVED_PENDING`/`REJECTED`/`EXPIRED` | 状态机 |
| pre_review_note | 预审判定说明 | varchar(128) 可空，含规则编号 | limit-service |
| decision_note | 审批意见 | varchar(256) 可空，拒绝时必填 | 审批人填写 |
| submitted_at | 提交时间 | timestamptz 非空 | 服务端 |
| decided_at | 决策时间 | timestamptz 可空 | 审批动作 |
| effective_at | 额度生效时间 | timestamptz 可空 | account-service |
| applicant | 申请人 | varchar(64) 非空 | IAM token |
| reviewer | 初审人 | varchar(64) 可空 | IAM token |
| approver | 终审人 | varchar(64) 可空，≠ `applicant` | IAM token |
| second_approver | 第二审批人 | varchar(64) 可空，用于双人审批 | IAM token |
| idempotency_key | 去重键 | varchar(64) 唯一索引 | 前端 |
| version | 乐观锁版本 | int 默认 0 | 服务端 |

**关联表与外部数据**

| 实体/字段 | 含义 | 类型/约束 | 来源 |
|-----------|------|----------|------|
| limit_application_document.application_id | 材料与申请关联 | varchar(32) 非空，联合唯一 `(application_id, document_id)` | limit-service |
| limit_application_document.document_id | 材料标识 | varchar(32) 非空 | document-service |
| account.credit_limit | 账户信用额度 | numeric(12,2) > 0 | account-service |
| limit_definition.account_id / max_amount | 账户限额定义与上限 | varchar(20) / numeric(12,2) | limit-service |

### 8.2 数据安全

| 维度 | 要求 |
|------|------|
| 脱敏 | 审批工作台列表中的客户姓名按「姓 + \*」展示；卡号仅后 4 位；收入区间以枚举展示，不展示原始金额明细 |
| 加密 | 收入材料由 document-service 加密存储（AES-256），本服务只保存 `documentId`；传输层 HTTPS |
| 留存 | 申请与审批记录留存 5 年；收入材料留存 2 年后自动归档删除；审计事件留存 3 年 |
| 访问 | 客户仅可读本人申请；审批人可读受理范围内的申请与材料；材料下载需鉴权并写审计；导出文件 24 小时失效 |
| 最小化 | 只采集用途、收入区间、期望额度与材料引用，不采集完整收入流水明细 |

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | 额度 8000 申请 12000，初审与终审通过 | 持卡人 + 初审 + 审批人 | POST `/limit-applications` → `/review` → `/approve` | 状态由 `SUBMITTED` 到 `APPROVED`，account 额度 5 秒内变为 12000，通知已发 |
| 主流程 | 初审拒绝并填写原因 | 初审 | POST `/admin/limit-applications/{id}/review` | 状态 `REJECTED`，客户进度页展示原因 |
| 边界 | 申请额度 = 当前额度 × 2（8000→16000） | 持卡人 | POST `/limit-applications` | 不触发双人审批，`dualApprovalRequired=false` |
| 边界 | 申请额度 = 当前额度 × 2 + 0.01（8000→16000.01） | 持卡人 | POST `/limit-applications` | 触发双人审批，`dualApprovalRequired=true` |
| 边界 | 申请额度 = 产品上限 25000 | 持卡人 | POST `/limit-applications` | 预审通过，允许进入初审 |
| 异常 | 近 6 个月存在 1 个月逾期 | 持卡人 | POST `/limit-applications` | 预审置 `REJECTED`，提示逾期记录 |
| 异常 | 同一账户 7 天内第 2 次提交 | 持卡人 | POST `/limit-applications` | 409 `LIMIT_APPLICATION_EXISTS` |
| 异常 | 初审人与终审人为同一账号 | 审批人 | POST `/admin/limit-applications/{id}/approve` | 403 `SOD_VIOLATION` |
| 异常 | 审批后 account-service 不可用 | 审批人 | 停用 account-service 后 POST `/approve` | 状态 `APPROVED_PENDING`，恢复后自动生效，无重复审批 |
| 异常 | 上传 6MB PDF 作为收入材料 | 持卡人 | POST `/limit-applications/{id}/documents` | 400 `INVALID_DOCUMENT` |
| 权限 | 客户 A 查询客户 B 的申请 | 持卡人 | GET `/limit-applications/{id}` | 404，无数据泄露 |
| 权限 | 风控合规账号尝试审批 | 风控/合规 | POST `/admin/limit-applications/{id}/approve` | 403，缺少 `limit:approve` |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 当前额度 8000、产品上限 25000、无逾期、开卡 24 个月 | 申请 12000 并由初审与终审通过 | 状态 `APPROVED`，account 额度 12000，客户收到通知 | 账户 00000000006 |
| US-002 | 近 6 个月存在 1 个月逾期 | 提交申请 12000 | 预审 `REJECTED`，展示「近 6 个月存在逾期记录」 | 账单逾期数据 1 条 |
| US-003 | 已存在进行中申请 | 再次提交申请 | 409 `LIMIT_APPLICATION_EXISTS`，申请表仅 1 条 | 复用 US-001 数据 |
| US-004 | 初审人与终审人为同一账号 | 执行终审 | 403 `SOD_VIOLATION`，申请状态不变 | 单账号双角色配置 |
| US-005 | 申请 8000→16000.01 | 提交并进入审批 | `dualApprovalRequired=true`，缺第二审批人时返回 `DUAL_APPROVAL_REQUIRED` | US-001 账户 + 材料 |
| US-006 | 审批通过后 account-service 停用 | 执行终审 | 状态 `APPROVED_PENDING`；恢复服务后自动生效且仅 1 次额度更新 | 停用与恢复容器 |
| US-007 | 申请被拒绝 | 打开客户进度页 | 展示拒绝原因与客服入口，拒绝原因为空时提交被拦截 | US-002 数据 |
| US-008 | 开卡 2 个月的账户 | 提交提额申请 | 预审拒绝，提示「开卡满 3 个月后可申请提额」 | 新开户 00000000007 |

## 11. 依赖与约束

### 11.1 依赖

| 依赖对象 | 用途 | 失败影响与处理 |
|---------|------|---------------|
| account-service | 额度读取与更新 | 生效失败保留 `APPROVED_PENDING`，自动重试 6 次 |
| limit-service | 产品上限与限额定义 | 预审阻断，申请保持 `SUBMITTED` |
| workflow-service | 初审与终审任务 | 审批待办不可见，任务重试创建 |
| document-service | 收入材料存储与鉴权下载 | 材料提交失败返回 `INVALID_DOCUMENT` |
| customer-service | 客户基本信息 | 审批详情缺失字段，展示占位并告警 |
| notification-service | 提额结果通知 | 主流程不回滚，记录待补发 |
| audit-service | 审计事件 | 写失败进入本地补偿日志 |
| IAM | 认证、角色与 SoD 主体 | 无 token 返回 401 |

### 11.2 影响分析

| 维度 | 影响 |
|------|------|
| 前台 | 账户视图、申请页、进度页、审批工作台、审批详情 |
| 后台 | limit-service 申请与规则；workflow 审批；account 额度更新；document 材料；notification 通知；audit 审计 |
| 数据 | `limit_application`、`limit_application_document`；账户额度版本与审计事件 |
| 接口 | 8 个新接口；账户响应增加「进行中提额申请」字段 |
| 配置 | 产品最大额度、审批角色、双人审批阈值（当前额度 2 倍）、通知模板 |
| 测试 | 资格规则、SoD、重复申请、审批后额度生效、下游失败重试 |
| 文档 | 本需求、API 目录、审批权限矩阵、提额政策说明 |

### 11.3 约束

- 复用现有 limit-service 与 workflow-service，不新建审批服务。
- 审批角色与权限矩阵需与 IAM/RBAC 对齐后再上线。
- 金额统一 `BigDecimal` / `numeric(12,2)`。
- 所有写接口支持去重键；审批决策不可覆盖，只可新增。
- 演示环境沿用 IAM 角色 `U`/`A`，POC 不做接口级强鉴权（ADR-007），但 SoD 校验必须保留。

## 12. 风险与假设

### 12.1 风险与应对

| 风险/假设 | 影响 | 应对 |
|-----------|------|------|
| 提额资格规则（用卡时长、次数、收入门槛）未经风控正式确认 | 规则调整频繁，返工成本高 | 规则全部配置化，支持灰度；v1.1 前标记 `SIMULATION` |
| 额度更新与限额同步跨两个服务 | 额度不一致 | 以 account-service 为准，失败回滚并重试；每日对账 |
| 是否需要外部征信查询未定 | 预审结论偏差 | 本期不接征信；预留预审扩展点 `externalScore` |
| 审批角色与 IAM/RBAC 未对齐 | SoD 校验失真 | 上线前完成权限矩阵评审并落库角色关系 |
| 假设单一申请对应单一账户 | 多账户客户需多次申请 | 按账户维度独立申请，前端提供账户切换 |
| 假设额度生效 ≤ 5 秒 | 客户感知延迟 | 生效超 30 秒触发告警并短信通知客户处理中 |

### 12.2 假设

- 本期只支持永久额度申请，临时额度与降额不在范围。
- 拒绝后的申诉走客服工单，不新增线上申诉流程。

### 12.3 待确认事项

1. 提额资格规则的具体阈值（待确认：风控出具正式规则表，当前为模拟值）。
2. 是否需要征信查询或外部数据源（待确认：风险政策确认，本期不接）。
3. 双人审批阈值的计算口径（待确认：当前按当前额度 2 倍）。
4. 审批角色与权限矩阵（待确认：与 IAM/RBAC 对齐后落库）。
5. 收入材料保留期限（待确认：当前设计为 2 年后归档删除，法务复核）。

## 13. 合规标注

| 维度 | 标注 |
|------|------|
| 监管（模拟） | 参照《商业银行信用卡业务监督管理办法》关于授信额度调整与客户知情的要求：提额须客户主动申请，结果须告知客户。本文件为演示材料，不构成监管合规结论。 |
| 制度（模拟） | 参照行内授信额度管理办法（模拟编号 LIMIT-POLICY-2026）：提额需预审、人工复核、审批留痕。 |
| SoD（职责分离） | 申请人≠初审人≠终审人；风控/合规只读；额度更新只能由系统按审批结果执行，人工无直接改额权限。 |
| 隐私（模拟） | 参照《个人信息保护法》，仅采集提额必需字段；收入材料加密存储并限制访问，留存期届满归档删除。 |
| 审计 | 提交、预审、初审、终审、额度变更、通知结果全量留痕，审计留存 3 年。 |
| 结论 | 模拟需求，资格规则与阈值为演示假设，投产前需风控、合规、法务三方会签。 |

---

## 附录 A 章节编号对照（检查脚本兼容）

| 旧版脚本章节 | 本文件章节 | 脚本匹配标题 |
|-------------|-----------|-------------|
| 10. 风险与应对 | 12. 风险与假设 | `## 10. 风险与应对` |
| 11. 合规标注 | 13. 合规标注 | `## 11. 合规标注` |
