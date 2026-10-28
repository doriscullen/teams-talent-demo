# 餐饮消费返现开发范式总结

> 场景：在既有微服务体系中新增“消费返现/奖励发放”能力 —— 活动资格校验、按比例/固定额/积分计算奖励、消费入账后触发发奖、幂等入账与失败重试。
> 依据：`analyzer.md`（餐饮返现 CATEGORY_CASHBACK 案例分析）与代码片段 01–04。

## 一、总体范式

| 维度 | 约定 |
|---|---|
| 架构 | 支撑域独立微服务（如 marketing-service）+ 存量域横向侵入点（transaction 入账触发、account 幂等入账） |
| 一致性 | 无 MQ 时用“本地事务 + 同步调用 + 幂等键 + 人工重试”（ADR-009 方案 A）；营销失败不影响账务主链路 |
| 分层 | interfaces → application → domain ← infrastructure（依赖倒置，domain 无 Spring 依赖） |
| 幂等 | 评估侧 `(campaign_id, transaction_id)` 唯一；入账侧 `reward_credit.reward_id` 唯一，先查后写双保险 |
| 金额/标识 | 全程 `BigDecimal(12,2)`；遗留标识零填充字符串（交易号 16 位、卡号 16 位、账户 11 位）；时间 `LocalDateTime` |
| 并发 | 聚合根带 `@Version` 乐观锁；极端并发预算可能超发 1 笔，需对账 |

## 二、实现步骤

### 步骤 1：定义活动聚合根与规则模型

**实现逻辑**：以聚合根承载活动规则、状态机与预算不变量；构造与编辑共用同一校验方法，按活动类型分支校验计价字段组合；状态迁移方法校验前置状态与时间/预算约束。

**规范约束**：
- 状态机：`DRAFT → ACTIVE ⇄ PAUSED → ENDED`，ENDED 为终态，仅 DRAFT 可编辑规则。
- 计价字段按类型自洽：固定返现要求 `fixedRewardAmount > 0`；比例返现要求 `rewardRate ∈ (0, 1]` 且预算 `> 0`（现金返现类）；积分要求 `pointsMultiplier > 0`。
- 通用规则校验：名称非空且 ≤ 长度上限、`startAt < endAt`、最低金额/预算非负、类别码格式。
- 业务断言统一抛 `BusinessRuleException("CODE", "message")`，不返回 null/哨兵。

**注意事项**：判定/金额比较用 `compareTo/signum`，严禁 `double`；预算不变量（`consumedAmount ≤ budget`）的扣减与校验方法成对出现，扣减前必须再查一次；聚合根 `updatedAt` 语义保持一致（统一用入参 `now`，避免混用 `LocalDateTime.now()`）。

**历史参考代码（一般化）**：
```java
@Entity
@Table(name = "campaign")
public class Campaign {
    // 状态机与规则字段（类型枚举、起止时间、最低金额、比例/固定额/单笔上限/每卡次数/预算/已消耗/倍数/是否需报名）
    public void applyDraft(CampaignDraft draft, LocalDateTime now) {
        if (status != DRAFT) throw new BusinessRuleException("CAMPAIGN_NOT_EDITABLE", ...);
        validate(draft);   // 按类型分支校验
        // 复制 draft 字段，trim / blankToNull 归一化
    }
    public void activate(LocalDateTime now) { /* 仅 DRAFT/PAUSED；未过期；现金返现需正预算 */ }
    public boolean isActiveAt(LocalDateTime moment) { /* status==ACTIVE && [startAt, endAt) */ }
    public boolean hasBudgetFor(BigDecimal amount) { /* consumedAmount+amount <= budget */ }
    public void consumeCashback(BigDecimal amount) { /* 校验后累加 consumedAmount */ }
}
```

**参考文件**：`marketing-service/.../domain/model/Campaign.java` 103–277 行；`CampaignDraft.java` 全部。

### 步骤 2：实现计价器与资格判定（纯领域服务）

**实现逻辑**：计价与资格判定做成无 Spring 依赖的静态/无状态领域服务，输入聚合根与交易上下文，输出结果对象；资格判定顺序即原因码优先级，命中即返回，便于前端直接展示原因。

**规范约束**：
- 计价：现金取固定额（优先）或 `round(amount × rate, 2)`（HALF_UP），再与单笔上限 `min`；积分 `floor(amount × multiplier)`；奖励必须 > 0 否则不发。
- 资格顺序：活动 ACTIVE 且在期内 → 账户状态 Y → 账户组匹配 → 类别匹配 → 金额 ≥ 最低 → 需报名时已报名 → 每卡次数未达上限 → 首刷类无历史奖励 → 预算充足。
- 结果用不可变 record（如 `Evaluation(eligible, reason, reward)`），失败原因用常量代码（如 `AMOUNT_TOO_LOW`），不返回异常。

**注意事项**：判定顺序与文档（如 MK-ELI）一一对应，顺序即对外语义；参与判定（只看能否参与）与交易判定（完整 + 计价）可拆两个入口；原因码统一常量集中定义。

**历史参考代码（一般化）**：
```java
public final class EligibilityPolicy {
    public static final String AMOUNT_TOO_LOW = "AMOUNT_TOO_LOW";
    public record Evaluation(boolean eligible, String reason, RewardComputation reward) { /* eligible/rejected 工厂 */ }
    public static Evaluation evaluateTransaction(Campaign c, AccountSnapshot a, BigDecimal amount,
                                                 String category, boolean enrolled, long rewardsOnCard, LocalDateTime now) {
        // 按顺序逐个 if 返回 rejected(reason)；全部通过后 compute 并校验 REWARD_ZERO / BUDGET_EXHAUSTED
    }
}
public final class RewardCalculator {
    public static RewardComputation compute(Campaign c, BigDecimal amount) { /* POINTS 取整 / CASHBACK 固定额优先+封顶 */ }
}
```

**参考文件**：`EligibilityPolicy.java` 403–470 行；`RewardCalculator.java` 495–516 行；`RewardComputation.java` 全部。

### 步骤 3：建立发奖记录实体（评估幂等载体）

**实现逻辑**：发奖记录实体承载奖励类型/金额/积分、状态机与失败原因；以业务自然键建数据库唯一约束，作为评估侧幂等的最终保障。

**规范约束**：
- 表唯一键 `(campaign_id, transaction_id)`（如 `uk_reward_campaign_txn`），建索引支持 `exists/count` 查询。
- 状态机 `PENDING → GRANTED / FAILED`；现金返现必须最终 GRANTED 或可重试 PENDING。
- 构造时校验奖励 > 0（金额与积分至少一项为正）；带 `@Version` 乐观锁列。
- Flyway 迁移脚本建表（`V1__xxx_schema.sql`），表名小写下划线，字段与实体 `@Column` 一一对应。

**注意事项**：唯一约束与代码 `exists` 检查双保险——检查防重复发奖，约束防并发竞态；状态方法（markGranted/markPending）幂等且清空/设置 failureReason。

**历史参考代码（一般化）**：
```java
@Entity
@Table(name = "reward_grant", uniqueConstraints = @UniqueConstraint(name = "uk_reward_campaign_txn",
        columnNames = {"campaign_id", "transaction_id"}))
public class RewardGrant {
    public void markGranted(LocalDateTime now) { status = GRANTED; grantedAt = now; failureReason = null; }
    public void markPending(String reason) { status = PENDING; failureReason = reason; }
}
```

**参考文件**：`RewardGrant.java` 75–109 行；`V1__marketing_schema.sql` 463–479 行。

### 步骤 4：编写评估与发放编排（应用服务）

**实现逻辑**：应用服务注入仓储端口、出站客户端与 `Clock`，编排“幂等检查 → 资格判定 → 扣预算 → 建记录 → 下游入账 → 保存”；下游失败转 PENDING 不中断其他活动；提供人工重试入口。

**规范约束**：
- 事务边界：`@Transactional(noRollbackFor = RemoteServiceException.class)`——下游返现失败时保留已保存的 PENDING 记录，不回滚。
- 多活动循环：单活动不满足只 `skipped` 并继续，不抛异常中断整批。
- 幂等：每活动先 `existsByCampaignAndTransaction`，命中记 `ALREADY_EVALUATED` 跳过；重复评估返回既有结果。
- 重试（fulfill）：先查记录，`!isGranted()` 才重试；cashback 再次调账户（幂等键兜底），成功 `markGranted`；失败 `markPending` + 保存 + 抛异常（由 noRollbackFor 保留状态）。
- 时间源注入 `Clock`（测试固定时间）；金额参数校验（非空、> 0、位数格式）放应用层入口。
- 参数校验失败抛 `InvalidRequestException`（400），记录不存在抛 `NotFoundException`（404）。

**注意事项**：外部调用放在事务内是方案 A 的明确取舍（长事务持有锁），依赖 noRollbackFor 保护；循环内每个下游失败点都要 try/catch 转状态而不是向上抛；`Clock` 统一时间戳避免测试不可控。

**历史参考代码（一般化）**：
```java
@Service
@Transactional(noRollbackFor = RemoteServiceException.class)
public class RewardEvaluationService {
    public EvaluationOutcome evaluate(EvaluationCommand cmd) {
        validate(cmd);
        for (Campaign c : campaigns.findActiveAt(now)) {
            if (rewards.existsByCampaignAndTransaction(c.id, cmd.transactionId())) { skipped(...); continue; }
            Evaluation e = EligibilityPolicy.evaluateTransaction(c, account, ...);
            if (!e.eligible()) { skipped(reason); continue; }
            try { c.consumeCashback(e.reward().amount()); }
            catch (BusinessRuleException ex) { skipped(BUDGET_EXHAUSTED); continue; }
            RewardGrant g = new RewardGrant(uuid(), ...);
            if (g.isCashback()) {
                try { accountClient.creditCashback(accountId, g.rewardId, campaignId, amount); g.markGranted(now); }
                catch (RemoteServiceException ex) { g.markPending(...); }
            } else { g.markGranted(now); }
            rewards.saveReward(g); campaigns.saveCampaign(c);
        }
    }
    public RewardView fulfill(String rewardId) { /* 幂等重试：isGranted 短路 */ }
}
```

**参考文件**：`RewardEvaluationService.java` 58–142 行；`RewardController.java` 34–65 行。

### 步骤 5：主链路（入账方）增加触发点，失败仅告警

**实现逻辑**：在入账用例的每笔成功交易后同步调用营销评估；调用失败捕获并告警，不影响入账结果；提供配置开关整体关闭。

**规范约束**：
- 调用位置：本地事务内入账成功后（同一方法体内，但异常被吞故不触发回滚）。
- 调用封装：独立出站适配器（如 `MarketingClient`），HTTP 异常转领域 `RemoteServiceException`；入参用 record DTO。
- 失败语义：`catch (RuntimeException)` → `log.warn`（日志只含业务标识如 transactionId），不回滚、不抛。
- 开关：`@Value("${marketing.enabled:true}")`，关闭即停止调用（回退路径）。
- 入账自身幂等：交易号先查后写，重复提交计 duplicates 跳过；单笔拒付不中断整批（记 REJECTED 原因码）。

**注意事项**：这是“营销不阻塞账务”的关键实现——靠“捕获异常不抛出”而非“事务提交后回调”；触发点应复用已解析的快照（卡/账户）构造命令，避免二次查询；日志不得打印卡号等敏感字段。

**历史参考代码（一般化）**：
```java
// PostingService.post() 每笔成功后：
private void evaluateRewards(TransactionRecord record, CardSnapshot card, PostingCommand cmd) {
    if (!marketingEnabled) return;
    try {
        marketingClient.evaluateRewards(new MarketingClient.RewardEvaluationCommand(
                record.getTransactionId(), cmd.cardNumber(), record.getAccountId(), card.customerId(),
                record.getAmount(), cmd.categoryCode(), cmd.typeCode(), cmd.description(), record.getProcessedTimestamp()));
    } catch (RuntimeException ex) {
        log.warn("Reward evaluation failed for transaction {}: {}", record.getTransactionId(), ex.getMessage());
    }
}
```

**参考文件**：`PostingService.java` 290–314 行；`MarketingClient.java` 28–56 行。

### 步骤 6：下游账户幂等入账

**实现逻辑**：账户域新增幂等入账用例：以业务幂等键（rewardId）先查后写，记录已入账事实；余额变动封装在聚合根方法内。

**规范约束**：
- 幂等表：`reward_credit(reward_id PK, account_id, campaign_id, amount, created_at)`，`reward_id` 即幂等键，重复调用直接返回当前账户，不重复扣减。
- 聚合根方法（如 `applyCashback`）：金额 > 0 校验、冲减欠款、余额可为负（溢缴/贷记）——语义注释说明方向。
- 双写顺序：先账户后幂等记录（同一本地事务）；先查后写。
- API：`POST /api/v1/accounts/{id}/cashback-credits`，入参 record + 校验注解。

**注意事项**：幂等键语义写进注释与文档（如 NR-REWARD-01）；余额冲减方向（减欠款）与记账（加欠款）方向相反，避免符号错误；表名/字段与遗留数据字典对应。

**历史参考代码（一般化）**：
```java
public Account creditCashback(String accountId, String rewardId, String campaignId, BigDecimal amount) {
    if (rewardCredits.existsByRewardId(rewardId)) return getById(accountId);   // 幂等
    Account account = getById(accountId);
    account.applyCashback(amount);
    Account saved = accounts.saveAccount(account);
    rewardCredits.saveCredit(new RewardCredit(rewardId, accountId, campaignId, amount, LocalDateTime.now()));
    return saved;
}
```

**参考文件**：`AccountApplicationService.java` 71–87 行；`Account.java` 212–218 行；`RewardCredit.java` 全部；`V3__reward_credit.sql` 全部；`AccountController.java` 73–79 行。

### 步骤 7：单元测试覆盖规则分支与幂等

**实现逻辑**：对纯领域服务逐分支测试原因码；对应用服务用 Mockito 桩仓储与客户端，验证发奖、PENDING、幂等跳过、重试。

**规范约束**：
- 领域测试：纯 JUnit + AssertJ，无 Spring；断言原因码常量而非字符串；覆盖每个资格分支与计价精度（HALF_UP、封顶、取整）。
- 应用测试：`@ExtendWith(MockitoExtension.class)` + `@Mock` 端口；固定 `Clock`；`ArgumentCaptor` 验证保存内容。
- 幂等断言：`verify(rewards, never()).saveReward(any())`（重复评估不保存）；下游未调用断言 `verify(client, never()).creditCashback(...)`。
- 失败分支：`doThrow(RemoteServiceException)` → 断言 grant 为 PENDING 且含原因。
- 金额断言用 `isEqualByComparingTo`（BigDecimal 等值比较）。

**注意事项**：不要断言日志或实现细节（`07-java-conventions.md` §7）；测试不得依赖外部网络/其他服务。

**参考文件**：`RewardEvaluationServiceTest.java` 45–179 行；`EligibilityPolicyTest.java` 全部；`RewardCalculatorTest.java` 全部。

## 三、其他概念与最佳实践

- **跨服务一致性的三种选择**：方案 A 同步 + 幂等键 + 重试（无中间件、链路短、资金事实不受营销影响）；方案 B Outbox + MQ（彻底解耦、可重放，成本高）；方案 C 日终批量（简单但非实时）。幂等键设计同时服务同步重试与未来事件重放，不返工（ADR-009 理由 3）。
- **失败域分离**：消费入账是资金事实，营销是附加权益，二者失败域必须分离——评估失败只告警不回滚；返现失败保留 PENDING 可重试。
- **幂等三层保障**：业务先查后写（应用层）→ 数据库唯一约束（并发兜底）→ 重试入口短路（已 GRANTED 不重复调用）。
- **乐观锁**：所有聚合根/实体带 `@Version`，替代遗留 READ-UPDATE + 人工并发比对（ADR-006）；预算消耗极端并发可能超发 1 笔，需对账（设计文档 §8 风险）。
- **架构约定**（`07-java-conventions.md`）：包结构 interfaces/application/domain/infrastructure；领域异常统一 `BusinessRuleException("CODE", msg)`；每服务独立库，禁止跨库 JOIN；REST 基础路径 `/api/v1/<资源复数>`，错误响应统一 `{"code","message","details"}`，HTTP 语义 400/404/409/503；Flyway `V1__schema` + `V2__seed`（幂等 INSERT）；标识零填充字符串，金额 BigDecimal，时间 LocalDateTime。
- **可观测性与回退**：服务暴露 `/actuator/health`；日志不打印卡号/SSN；开关配置（如 `marketing.enabled`）提供整体回退路径；重试接口（fulfill）是 PENDING 治理的必备入口。
- **测试分层**：纯领域单测（无 Spring）+ `@SpringBootTest`/MockMvc 端到端 + H2 双跑迁移与种子数据。
