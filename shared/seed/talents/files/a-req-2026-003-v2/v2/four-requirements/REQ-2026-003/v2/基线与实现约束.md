> v2 节点资料：以下原始章节/历史基线摘录保持原意。当前本地测试参数以本目录 `test-profile.md` v2 为准；正式第 12.3 节仍待确认。不得自行把其它推断政策转成已确认。

# REQ-2026-003 · 基线与实现约束

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
