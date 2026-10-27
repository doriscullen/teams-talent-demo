# ADR-012：分期接口认证与后台角色区分

| 项 | 内容 |
|----|------|
| 编号 | ADR-012 |
| 日期 | 2026-10-28 |
| 状态 | 已接受（本地演示；正式 RBAC 待 PRD §12-8 确认） |
| 关联需求 | REQ-2026-001（PRD v1.1 PRD-004、BR-INS-13），AC-14/AC-15/AC-21 |

## 背景

- 原文 §6.2 要求 JWT；ADR-007 与实现是 `base64url(userId|userType|exp).base64url(HmacSHA256)`，资源服务不强制校验（方案 A）。
- 原文 §2 有三类角色（持卡人 / 客服运营 / 风控合规）；基线 IAM 只有 `userType ∈ {A, U}`，没有权限点。
- PRD v1.1 PRD-004 要求：客服可协助写、风控只读**必须可执行区分**，不得仅凭 `userType=A` 放行写操作，也不得扩大为全平台认证改造。

## 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 信任请求体/自定义头身份 | 前端传 userId/role | 零成本 | 可伪造，直接违反 §6.2 与 PRD |
| B. 分期服务内 HMAC 过滤器 + 本地权限表 | 校验 IAM token，`installment_permission` 表区分 STAFF_ASSIST / RISK_READONLY | 真实 token 可验证；不动其它服务；可测 | 权限表与 IAM 分离，需同步维护 |
| C. 引入网关 + JWT + 统一权限中心 | 全平台改造 | 生产方向正确 | 超出本期范围，风险与工作量最大 |

## 决策

采用 **B**：

1. `TokenAuthenticationFilter` 只拦截 `/api/v1/installments/**` 与 `/api/v1/admin/installments/**`；无/坏/过期 token → 401 `UNAUTHENTICATED`。
2. 主体（userId、userType）来自 token，写入请求属性；业务层不使用请求体或 `X-User-Id` 判定身份。
3. `AccessGuard`：
   - 客户（U）：必须命中 `installment_account_access`，否则 404（不泄露存在性）；
   - 后台（A）：`STAFF_ASSIST` 可协助写；`RISK_READONLY` 只读，写请求 403；无任何权限点的 A 也 403。
4. 本地种子：`ADMIN001/ADMIN002=STAFF_ASSIST`、`ADMIN003=RISK_READONLY`；持卡人 `USER0001→00000000006`、`USER0002→00000000005`（`services/iam-service/.../V3__installment_roles.sql` 提供真实可登录身份）。

## 后果

- 正面：AC-21 可用三/四个真实 token 验证；不触碰其它服务的鉴权实现。
- 负面：权限点数据在分期库，与 IAM 存在双写风险；生产化需迁移到统一权限中心（PRD §12-7/12-8）。
- 回退：接入网关后，删除过滤器、改由网关注入可信主体，`AccessGuard` 规则可保留。
