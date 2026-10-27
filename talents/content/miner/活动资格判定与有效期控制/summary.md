# 营销活动资格判定与有效期控制 开发范式总结

> 场景：实现营销活动资格校验与有效期控制，包含活动状态、时间窗口、账户状态、目标账户组、报名及参与限制。
> 依据：`analyzer.md`（marketing-service 活动资格判定与有效期控制案例分析）与代码片段 01–02。

## 一、总体范式

| 维度 | 约定 |
|---|---|
| 架构 | 支撑域独立微服务（如 marketing-service），DDD 四层：interfaces → application → domain ← infrastructure；资格判定放在 **domain/service 的无状态策略类**，规则与状态放在 **domain/model 聚合根** |
| 有效期控制 | 双维度：**状态机**（人为开关：`DRAFT → ACTIVE ⇄ PAUSED → ENDED`，ENDED 终态）+ **时间窗**（自然边界：`[startAt, endAt)` 左闭右开）；二者在判定方法 `isActiveAt` 中合成为"活动有效" |
| 资格校验 | 判定链以**固定顺序**逐条检查，顺序即原因码优先级，命中第一个不满足即返回原因；结果用不可变 record 返回（非异常），原因码常量集中定义 |
| 数据边界 | 跨域只读数据用**快照传输对象**（record，不落库、不入聚合）；判定所需的账户状态/账户组由出站适配器实时获取 |
| 领域不变量 | 规则校验收敛在聚合根（构造与编辑共用同一 `validate`）；业务断言统一抛 `BusinessRuleException("CODE", msg)`；金额 `BigDecimal` 禁止 double；标识零填充定长字符串 |
| 并发 | 聚合根带 `@Version` 乐观锁；预算类资源"判定（hasBudgetFor）与扣减（consumeCashback）分离，扣减前二次校验"，极端并发可能超发 1 笔需对账 |

## 二、实现步骤

### 步骤 1：定义状态枚举与规则草案载体

**实现逻辑**：用枚举表达活动状态（落库 `EnumType.STRING`）；用不可变 record 作为"活动规则草案"，一次性承载全部可编辑字段，新建与编辑共用同一载体。

**规范约束**：
- 状态枚举只含状态值（如 `DRAFT/ACTIVE/PAUSED/ENDED`），不掺规则字段；JPA 用 `@Enumerated(EnumType.STRING)` 落库，禁止 ORDINAL。
- 草案 record 字段与"可编辑规则"一一对应；不可变、无逻辑，仅作传输载体。
- 枚举/record 文件名与领域语言一致（如 `CampaignStatus`、`CampaignDraft`）。

**注意事项**：草案与实体分离（CQ 思想）避免把"可编辑的规则集"与"聚合根状态"耦合；后续新增规则字段时两处同步修改。

**历史参考代码（一般化）**：
```java
public enum CampaignStatus { DRAFT, ACTIVE, PAUSED, ENDED }   // 状态机四态

public record CampaignDraft(   // 规则草案：全部可编辑字段
        String name, String description, CampaignType campaignType,
        LocalDateTime startAt, LocalDateTime endAt,
        String targetGroupId, String categoryCode,
        BigDecimal minTransactionAmount, BigDecimal rewardRate,
        BigDecimal fixedRewardAmount, BigDecimal maxRewardPerTransaction,
        Integer maxRewardsPerCard, BigDecimal budget,
        BigDecimal pointsMultiplier, boolean enrollmentRequired) {
}
```

**参考文件**：`CampaignStatus.java` 全文件；`CampaignDraft.java` 全文件。

### 步骤 2：实现聚合根（规则字段 + JPA 映射）

**实现逻辑**：聚合根承载活动全部规则字段与不变量；JPA 映射 `@Column` 与表字段一一对应；带 `@Version` 乐观锁；提供 JPA 专用 protected 无参构造与业务构造器（初始状态 + 初始累计量）。

**规范约束**：
- 金额列 `BigDecimal` + `@Column(precision=12, scale=2)`，禁止 `double`；时间列 `LocalDateTime`；标识列定长（如 36 位 UUID 字符串）。
- `@Version long version` 乐观锁列必配（替代遗留 READ-UPDATE + 人工比对，ADR-006）。
- 业务构造器接收 `now` 参数（而非内部 `LocalDateTime.now()`），初始化创建/更新时间戳与初始累计量。
- 类注释写明状态机与规则出处（如"状态机：DRAFT → ACTIVE ⇄ PAUSED → ENDED"）。

**注意事项**：`updatedAt` 语义全程统一（用入参 `now`），避免混用 `LocalDateTime.now()` 导致测试不可控；字段默认值（如 `ZERO` 常量）用 `BigDecimal("0.00")` 显式表达精度。

**历史参考代码（一般化）**：
```java
@Entity
@Table(name = "<activity_table>")
public class <ActivityAggregate> {
    @Id @Column(name = "activity_id", length = 36, nullable = false, updatable = false) private String activityId;
    @Enumerated(EnumType.STRING) @Column(name = "status", length = 16, nullable = false) private <Status> status;
    @Column(name = "start_at", nullable = false) private LocalDateTime startAt;
    @Column(name = "end_at", nullable = false) private LocalDateTime endAt;
    @Version @Column(name = "version", nullable = false) private long version;

    protected <ActivityAggregate>() { /* for JPA */ }

    public <ActivityAggregate>(String id, <Draft> draft, LocalDateTime now) {
        this.activityId = id;
        this.status = <Status>.DRAFT;               // 初始状态
        this.consumed = ZERO;                        // 初始累计量
        this.createdAt = now; this.updatedAt = now;
        applyDraft(draft, now);                      // 新建即走同一校验
    }
}
```

**参考文件**：`Campaign.java` 41–125 行（字段与构造）。

### 步骤 3：规则校验（构造/编辑共用）+ 编辑入口

**实现逻辑**：静态校验方法 `validate(draft)` 覆盖通用规则与按类型分支的计价字段自洽性；`applyDraft` 仅允许编辑态（如 DRAFT），字段 trim/空转 null 归一化后写入并更新 `updatedAt`。

**规范约束**：
- 通用校验：名称非空且 ≤ 长度上限、类型必填、`startAt < endAt`、最低金额/预算非负、类别码格式（如 4 位数字）、次数类字段 >0。
- 按类型分支（switch 表达式）：固定返现类需正固定额；比例返现类需"比例或固定额至少其一"且比例 ≤ 1（100%）、需正预算；积分类需正倍数；`default` 分支拒绝未支持类型。
- 校验失败抛 `BusinessRuleException("CODE", "message")`，不返回 null/哨兵。
- 归一化辅助函数（如 `blankToNull` + `trim`）处理可选字段的空白语义。

**注意事项**：**新建与编辑必须共用同一 `validate`**，否则"新建合法、编辑绕过校验"；switch 每个分支的字段组合要对照需求逐条列举；`compareTo/signum` 做数值比较，奖励率上限判断用 `compareTo(BigDecimal.ONE) > 0`。

**历史参考代码（一般化）**：
```java
public void applyDraft(<Draft> draft, LocalDateTime now) {
    if (status != <Status>.DRAFT) throw new BusinessRuleException("<CODE>_NOT_EDITABLE", "Only DRAFT can be edited.");
    validate(draft);
    // 字段复制：name.trim()；可选字段 blankToNull(...)
    this.updatedAt = now;
}
private static void validate(<Draft> draft) {
    if (draft.name() == null || draft.name().isBlank()) throw new BusinessRuleException("INVALID_<ENTITY>", "...");
    if (!draft.startAt().isBefore(draft.endAt())) throw new BusinessRuleException("INVALID_PERIOD", "...");
    switch (draft.type()) {
        case FIXED -> { /* 需正固定额 */ }
        case RATE  -> { /* 比例或固定额至少其一；比例 ≤ 100%；预算 > 0 */ }
        case POINTS-> { /* 需正倍数 */ }
        default    -> throw new BusinessRuleException("INVALID_TYPE", "Unsupported type.");
    }
}
```

**参考文件**：`Campaign.java` 130–151 行（applyDraft）、234–292 行（validate）、294–296 行（blankToNull）。

### 步骤 4：状态机方法（有效期控制的操作面）

**实现逻辑**：状态迁移方法各自校验"前置状态 + 时间/资源约束"后置为下一状态并更新时间戳；非法迁移抛业务异常。

**规范约束**：
- `activate(now)`：仅 DRAFT/PAUSED 可激活；`now` 必须在结束时间之前（未过期）；现金返现类要求预算 >0（否则 `BUDGET_REQUIRED`）。
- `pause(now)`：仅 ACTIVE；`end(now)`：仅 ACTIVE/PAUSED（ENDED 为终态，不可再迁移）。
- 每个方法末尾 `status = ...; updatedAt = now;`。

**注意事项**：**状态机（人为开关）与时间窗（自然边界）分开校验**——`activate` 只查"未过期"，真正"活动有效"由判定方法 `isActiveAt` 同时检查状态与时间窗，形成双保险；已过期活动即使误置 ACTIVE 也不会发放。

**历史参考代码（一般化）**：
```java
public void activate(LocalDateTime now) {
    if (status != <Status>.DRAFT && status != <Status>.PAUSED)
        throw new BusinessRuleException("INVALID_<ENTITY>_STATE", "Only DRAFT or PAUSED can be activated.");
    if (!now.isBefore(endAt))
        throw new BusinessRuleException("<ENTITY>_EXPIRED", "End time has passed.");
    if (<type> == <CASHBACK_TYPE> && budget.signum() <= 0)
        throw new BusinessRuleException("BUDGET_REQUIRED", "Cashback requires a positive budget.");
    this.status = <Status>.ACTIVE;
    this.updatedAt = now;
}
public void pause(LocalDateTime now)  { /* 仅 ACTIVE → PAUSED */ }
public void end(LocalDateTime now)    { /* 仅 ACTIVE/PAUSED → ENDED（终态） */ }
```

**参考文件**：`Campaign.java` 153–183 行（activate/pause/end）。

### 步骤 5：判定查询方法（有效期控制的判定面）

**实现逻辑**：在聚合根上实现"活动当前是否有效、是否命中目标"的纯领域判定方法，供资格策略调用。

**规范约束**：
- `isActiveAt(moment)`：`status == ACTIVE && !moment.isBefore(startAt) && moment.isBefore(endAt)`——**左闭右开**。
- 目标匹配方法（`matchesGroup`/`matchesCategory`）：**目标字段为 null 即通配（不限制）**，`target == null || Objects.equals(target, 实际值)`。
- 资源判定（`hasBudgetFor(amount)`）：仅对资源型活动生效（如现金返现），`consumedAmount + amount <= budget` 用 `compareTo`；预算无约束（signum<=0）视为通过。
- 资源查询（`remainingBudget()`）：无预算约束返回 null（表示"不适用"而非"为 0"），避免与"预算耗尽"混淆。

**注意事项**：空值通配是"目标账户组/类别限制"的关键语义，判定方法必须显式处理 null；预算"判定与扣减"方法成对出现但职责分离（本步只判定）。

**历史参考代码（一般化）**：
```java
public boolean isActiveAt(LocalDateTime moment) {
    return status == <Status>.ACTIVE && !moment.isBefore(startAt) && moment.isBefore(endAt);
}
public boolean matchesGroup(String accountGroupId) {
    return targetGroupId == null || Objects.equals(targetGroupId, accountGroupId);   // null 即通配
}
public boolean hasBudgetFor(BigDecimal rewardAmount) {
    if (!isCashback()) return true;
    if (budget.signum() <= 0) return true;
    return consumedAmount.add(rewardAmount).compareTo(budget) <= 0;
}
```

**参考文件**：`Campaign.java` 185–232 行（isActiveAt/matchesGroup/matchesCategory/hasBudgetFor/remainingBudget）。

### 步骤 6：实现无状态资格判定策略（核心）

**实现逻辑**：领域服务以**固定顺序的判定链**检查资格；顺序即原因码优先级，命中第一个不满足条件即返回；结果用不可变 record 承载（`eligible` + 原因码 + 奖励），不抛异常表达"不合格"。

**规范约束**：
- 原因码全部 `public static final String` 常量集中定义（如 `AMOUNT_TOO_LOW`、`GROUP_MISMATCH`），供判定、调用方 skipped 记录、前端文案、测试共用。
- 结果对象 `Evaluation(boolean eligible, String reason, <Reward>)` 提供 `eligible(reward)`/`rejected(reason)` 工厂方法。
- **两个入口**：参与判定（只判"能否参与"，不含交易金额/类别/次数）与完整交易判定（复用参与判定后叠加交易级检查 + 计价）。
- 判定链顺序（一般化）：活动有效 → 账户存在 → 账户状态 → 目标账户组 → 类别 → 金额达标 → 需报名时已报名 → 参与次数未达上限 → 唯一性限制（如首刷无历史）→ 计算奖励 → 奖励非零 → 资源充足。
- 判定所需的外部事实（是否已报名、已参与次数）由调用方传入参数，**策略保持无状态、无 IO、无 Spring 依赖**。

**注意事项**：判定顺序与需求文档逐条对应，顺序即对外语义（前端展示原因、批量评估跳过都依赖它）；公共判定下沉到参与入口、交易级判定叠加，避免两处逻辑漂移；"不合格"是业务常态用返回值，"不变量被破坏"（如奖励为零的构造）才用异常——两类错误处理边界要分清。

**历史参考代码（一般化）**：
```java
public final class <Eligibility>Policy {
    public static final String NOT_ACTIVE = "<ENTITY>_NOT_ACTIVE";
    public static final String GROUP_MISMATCH = "<ENTITY>_GROUP_MISMATCH";
    // ... 全部原因码常量

    public record Evaluation(boolean eligible, String reason, <Reward> reward) {
        static Evaluation eligible(<Reward> reward)      { return new Evaluation(true, null, reward); }
        static Evaluation rejected(String reason)        { return new Evaluation(false, reason, null); }
    }

    public static Evaluation evaluateParticipation(<Aggregate> e, <AccountSnapshot> a, boolean enrolled, LocalDateTime now) {
        if (!e.isActiveAt(now))                  return Evaluation.rejected(NOT_ACTIVE);
        if (a == null)                            return Evaluation.rejected(ACCOUNT_NOT_FOUND);
        if (!"Y".equals(a.activeStatus()))        return Evaluation.rejected(ACCOUNT_INACTIVE);
        if (!e.matchesGroup(a.groupId()))         return Evaluation.rejected(GROUP_MISMATCH);
        if (e.isEnrollmentRequired() && !enrolled) return Evaluation.rejected(NOT_ENROLLED);
        return Evaluation.eligible(null);
    }

    public static Evaluation evaluateTransaction(<Aggregate> e, <AccountSnapshot> a, BigDecimal amount,
                                                 String category, boolean enrolled, long timesOnCard, LocalDateTime now) {
        Evaluation p = evaluateParticipation(e, a, enrolled, now);   // 复用公共判定
        if (!p.eligible()) return p;
        if (!e.matchesCategory(category))                 return Evaluation.rejected(CATEGORY_MISMATCH);
        if (amount.compareTo(e.getMinAmount()) < 0)       return Evaluation.rejected(AMOUNT_TOO_LOW);
        if (e.getMaxTimes() != null && timesOnCard >= e.getMaxTimes()) return Evaluation.rejected(TIMES_LIMIT_REACHED);
        if (e.getType() == <FIRST_TYPE> && timesOnCard > 0) return Evaluation.rejected(ALREADY_REWARDED);
        <Reward> reward = <Calculator>.compute(e, amount);
        if (reward.amount().signum() <= 0 && reward.points() <= 0) return Evaluation.rejected(REWARD_ZERO);
        if (!e.hasBudgetFor(reward.amount()))             return Evaluation.rejected(BUDGET_EXHAUSTED);
        return Evaluation.eligible(reward);
    }
}
```

**参考文件**：`EligibilityPolicy.java` 全文件（重点 447–471 行常量与 Evaluation、476–494 行 participation、499–529 行 transaction）。

### 步骤 7：跨域账户快照与判定接入（应用层）

**实现逻辑**：Account 域数据通过出站适配器获取为只读快照 record；应用服务（活动中心查询 / 交易评估）在事务内"取账户快照 → 取活动列表 → 逐活动判定 → 组装结果"，判定所需的报名/次数事实由仓储统计后传入策略。

**规范约束**：
- 快照 record 只含判定所需字段（如 `accountId/activeStatus/currentBalance/groupId`），注释声明"营销只读，不保存"——维护数据所有权边界（ADR-003）。
- 出站适配器：读接口 404 转 `Optional.empty()`（不存在），非 2xx 转领域 `RemoteServiceException`（真实失败），网络异常统一包装；响应体用内部 record 转换到快照。
- 活动列表用 `findActiveAt(now)` 仓储查询（SQL 预筛 `status=ACTIVE && startAt<=now && endAt>now`），缩小判定集合。
- 参与入口（活动中心）结果含 `eligible + reason` 供前端展示；交易入口对不合格活动记录跳过原因（skipped），不中断同批其他活动。
- 时间源注入 `Clock`，统一 `LocalDateTime.now(clock)`。

**注意事项**：快照是实时的（不缓存账户状态），保证判定时账户状态不过期；参与判定与交易判定两个调用点必须走同一策略类，避免语义漂移；账户不存在在活动中心是"整页失败"（404），在交易评估是"该活动跳过"（ACCOUNT_NOT_FOUND）——调用方按业务场景决定。

**历史参考代码（一般化）**：
```java
// domain/model：只读快照（不落库）
public record <AccountSnapshot>(String accountId, String activeStatus,
                                BigDecimal currentBalance, String groupId) { }

// application：参与查询（活动中心）
for (<Aggregate> e : repo.findActiveAt(now)) {
    boolean enrolled = enrollments.findEnrollment(e.getId(), cardNumber).isPresent();
    Evaluation ev = <Eligibility>Policy.evaluateParticipation(e, account, enrolled, now);
    views.add(new OfferView(e, enrolled, ev.eligible(), ev.reason()));
}

// application：交易评估
for (<Aggregate> e : repo.findActiveAt(now)) {
    if (rewards.existsBy<Key>(e.getId(), txnId)) { skipped(...ALREADY_*); continue; }
    boolean enrolled = enrollments.findEnrollment(...).isPresent();
    long times = rewards.countBy<Dim>(e.getId(), cardNumber);
    Evaluation ev = <Eligibility>Policy.evaluateTransaction(e, account, amount, category, enrolled, times, now);
    if (!ev.eligible()) { skipped(e.getId(), ev.reason()); continue; }
    // 扣资源 → 建记录 → 落库/调下游
}
```

**参考文件**：`AccountSnapshot.java` 全文件；`AccountClient.java` 28–63 行；`MarketingQueryService.java` 46–59 行；`RewardEvaluationService.java` 57–81 行。

### 步骤 8：领域单测固化规则分支

**实现逻辑**：纯 JUnit + AssertJ 对聚合根状态机与策略判定链逐分支断言；测试即 MK-ELI 需求编号的可执行回归基线。

**规范约束**：
- 聚合根测试：初始态/初始累计量断言；合法迁移（activate→consume→pause→activate→end）全链路；每个非法迁移（DRAFT 不可 pause、ACTIVE 不可再 activate、ENDED 不可再 activate、ACTIVE 不可编辑）断言异常；规则校验分支（非法时段、缺计价字段、现金返现无预算）断言错误码。
- 策略测试：一个"全部满足"正例断言奖励金额；每个拒绝分支（NOT_ACTIVE/ACCOUNT_INACTIVE/GROUP_MISMATCH/CATEGORY_MISMATCH/AMOUNT_TOO_LOW/NOT_ENROLLED/TIMES_LIMIT_REACHED/ALREADY_REWARDED/BUDGET_EXHAUSTED）逐一断言原因码常量。
- 断言方式：异常断言 `assertThatThrownBy(...).isInstanceOf(BusinessRuleException.class).extracting("code").isEqualTo("...")`；金额断言 `isEqualByComparingTo`（BigDecimal 等值，不用 `isEqualTo`）。
- 测试辅助：固定 `LocalDateTime` 常量 + 工厂方法构造规则草案（缩短用例）；断言原因码用策略常量而非字面量。

**注意事项**：不断言日志或实现细节（`07-java-conventions.md` §7）；测试不得依赖 Spring 容器/外部网络；**每个判定分支必须有一条用例**——策略类分支多，漏测分支会直接漏规则。

**历史参考代码（一般化）**：
```java
@Test
void budgetCannotBeExceeded() {
    Campaign c = new Campaign("c1", draft(), NOW);
    c.activate(NOW);
    assertThatThrownBy(() -> c.consume(new BigDecimal("1000.01")))
            .isInstanceOf(BusinessRuleException.class)
            .extracting("code").isEqualTo("BUDGET_EXHAUSTED");
}

@Test
void rejectsWrongCategory() {
    Evaluation ev = EligibilityPolicy.evaluateTransaction(campaign(), ACCOUNT,
            new BigDecimal("120.00"), "9999", true, 0, NOW);
    assertThat(ev.reason()).isEqualTo(EligibilityPolicy.CATEGORY_MISMATCH);
}
```

**参考文件**：`CampaignTest.java` 全文件；`EligibilityPolicyTest.java` 全文件。

## 三、其他概念与最佳实践

- **有效期控制的两把锁**：状态机是人为开关（运营可控），时间窗是自然边界（`[startAt, endAt)` 左闭右开）；二者分别校验、在 `isActiveAt` 合成。编辑/发布/发放都要防"过期活动复活"：`activate` 校验未过期、`isActiveAt` 双查、仓储预筛 `endAt > now`。
- **资格判定：返回值 vs 异常**：判定链中"不合格"是业务常态（活动中心展示、批量评估跳过），用 `Evaluation(eligible, reason)` record 返回；只有"业务规则被破坏"（如奖励为零仍构造记录）才抛 `BusinessRuleException`。判定链顺序即对外语义，新增规则必须插入正确优先级位置并同步文档编号（如 MK-ELI-xx）。
- **空值通配模式**：目标维度（账户组/类别）字段为 null 表示"不限制"——`target == null || Objects.equals(target, actual)`。这是"定向 vs 全量"营销活动的统一建模方式，注意与"字段必填校验"的边界（可空 = 通配，非空 = 精确匹配）。
- **判定与扣减分离**：资源类限制（预算）先"判定足够"再"扣减"，扣减方法内部二次校验；并发兜底靠 `@Version` 乐观锁；极端并发下资源可能超发 1 笔，属已记录风险需对账（设计文档风险章节）。
- **领域建模（充血模型）**：规则、状态机、不变量全部收敛在聚合根；领域服务无状态、无 IO、无 Spring 依赖——纯逻辑可单测，两个入口复用同一策略保证语义一致。
- **跨域数据边界（ADR-003）**：账户状态/账户组属 Account 域，营销只以只读快照 record 传输、不落库；出站适配器 404 与真实失败要区分（不存在 → Optional.empty，失败 → RemoteServiceException）。
- **原因码可解释性**：资格原因码是前端文案与用户沟通的契约，必须集中常量定义、与测试共用同一符号、在 API 响应中原样透出；错误响应统一 `{"code","message","details"}`（400/404/409/503 语义）。
- **金额与标识基线**（`07-java-conventions.md`）：金额一律 `BigDecimal(precision=12, scale=2)` + `compareTo/signum`；遗留标识零填充定长字符串（账户 11 位、卡号 16 位）；时间 `LocalDateTime` + 注入 `Clock`。
- **需求可追溯性**：规则实现处保留需求编号注释（如 MK-ELI-01..09、MK-CAM-01..06），与设计文档 `docs/design/08-marketing-capability.md` 对应，门禁评审与审计可溯源。
