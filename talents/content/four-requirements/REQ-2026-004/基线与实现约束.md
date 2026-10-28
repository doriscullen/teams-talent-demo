# REQ-2026-004 · 基线与实现约束

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
