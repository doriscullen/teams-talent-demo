# 账户余额乐观锁更新：开发范式总结

> 一般性场景：实现账户余额更新的乐观锁机制，包含实体版本字段、事务内余额变更及并发更新冲突的统一错误响应。

## 一、实现步骤

### 步骤 1：在聚合根实体上添加乐观锁版本字段

**实现逻辑**：在承载余额更新的聚合根实体（如 `Account`）上声明 `@Version` 注解的长整型字段，并映射到数据库 `version` 列。`@Version` 是 JPA/Hibernate 乐观锁的触发点：实体一旦托管，`save` 时 Hibernate 会自动生成带版本条件的 UPDATE（`WHERE id=? AND version=?`），并在并发修改导致影响行数为 0 时抛出 `OptimisticLockingFailureException`，整个事务回滚。

**规范约束**：

- 版本字段用 `long` 而非 `Long`/`Integer`，映射为数据库 `BIGINT`。
- 字段必须有 `@Column(name = "version", nullable = false)`，与 DDL 列名严格一致。
- 新对象构造时必须显式初始化 `version = 0`，与数据库列 `DEFAULT 0` 对齐，避免插入行版本错位。

**注意事项**：

- 冲突异常在 **flush/提交时**抛出，不在 `save()` 调用时抛出——业务代码不需要 try-catch，但必须在全局异常处理器兜底。
- 变更必须在**同一事务**内先加载（取得托管实体）再修改，`save` 才会走 merge 分支、携带版本条件；否则退化为插入新行或无条件更新。
- `@Version` 实体保存后版本号自动递增，返回给调用方的必须是递增后的新值。

**历史可参考代码**（一般化表示）：

```java
@Entity
@Table(name = "<聚合表>")
public class <AggregateRoot> {
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    public <AggregateRoot>(<Id> id, ...) {
        ...
        this.version = 0;
    }
}
```

**参考文件**：`Account.java`（新增文件，内容起始行 154、终止行 156；构造初始化行 165）。

### 步骤 2：数据库迁移脚本同步版本列

**实现逻辑**：建表迁移脚本（`V*__schema.sql`）中为聚合表增加 `version` 列，`BIGINT NOT NULL DEFAULT 0`。实体与 DDL 必须一致，因为仓库配置 `ddl-auto: validate` 在启动时校验两者，不一致直接启动失败。

**规范约束**：

- 列定义统一为 `version BIGINT NOT NULL DEFAULT 0`。
- 使用 Flyway 版本化脚本管理（`src/main/resources/db/migration`），不依赖 Hibernate 自动建表。
- 种子数据脚本必须给 `version` 列显式赋值 0，保证既有行与新实体初始版本一致。

**注意事项**：

- 若 `ddl-auto` 为 `validate`，实体新增 `@Version` 字段后必须**同步提交**迁移脚本，否则服务无法启动。
- 种子 INSERT 若列清单省略 `version`，需依赖 `DEFAULT 0` 生效；建议显式列出以保证可读性。

**历史可参考代码**（一般化表示）：

```sql
CREATE TABLE <aggregate_table> (
    ...,
    version BIGINT NOT NULL DEFAULT 0
);
```

**参考文件**：`V1__account_schema.sql`（新增文件，内容起始行 369、终止行 383，`version` 列在行 382）。

### 步骤 3：在实体上集中实现余额变更领域行为

**实现逻辑**：将余额变更规则实现为聚合根上的领域方法（充血模型），如 `applyPosting(amount)`、`applyBillPayment(amount)`、`accrueInterest(amount)`。每个方法完成业务规则校验（金额正负、欠款是否存在、是否超额）与字段变更；规则失败抛领域异常 `BusinessRuleException("CODE", "message")`。规则及错误码可追溯遗留业务规则编号（如 BR-POST-006）。

**规范约束**：

- 领域行为写在实体上，不写在 Service 里堆 setter（仓库 Java 约定 §3）。
- 金额统一 `BigDecimal`，用 `signum()`/`compareTo()` 判断正负与大小，禁止 `double`、禁止 `==` 比较。
- 校验失败统一抛 `BusinessRuleException(code, message)`，`code` 用大写蛇形错误码。
- 参数为空抛 `Objects.requireNonNull` 或同款业务异常，不静默处理。

**注意事项**：

- 余额字段更新用 `currentBalance.add/subtract(...)` 重新赋值，不要用 `+=`（不可变 BigDecimal）。
- 需要清零累计值的操作（如利息入账清零本期贷/借累计）在领域方法内一并完成，保持聚合内一致性。
- 校验与变更必须原子完成——校验失败抛出异常即回滚整个事务。

**历史可参考代码**（一般化表示）：

```java
public void apply<BizAction>(BigDecimal amount) {
    // 1. 规则校验：不满足则 throw new BusinessRuleException("CODE", "message");
    // 2. 字段变更：currentBalance = currentBalance.add/subtract(amount); ...
}
```

**参考文件**：`Account.java`（新增文件，`applyPosting` 行 171-179、`applyBillPayment` 行 184-196、`accrueInterest` 行 201-206、`applyCashback` 行 212-218）。

### 步骤 4：应用服务定义事务边界并编排"读-改-写"

**实现逻辑**：创建用例应用服务（`@Service`），类级标注 `@Transactional` 界定事务边界；查询方法覆盖 `@Transactional(readOnly = true)`。每个变更方法按固定三步编排：`getById(accountId)`（读聚合根，未找到抛 `NotFoundException`）→ 调用领域方法变更状态 → `saveAccount(account)` 持久化。全部操作落在同一事务内，保证原子性与版本一致性。

**规范约束**：

- 事务边界放在**应用服务**层，不在 Controller 或 Repository（仓库分层规范：`interfaces → application → domain ← infrastructure`）。
- 类级 `@Transactional` + 方法级 `readOnly = true` 覆盖查询。
- 通过构造器注入仓储端口（`private final` 字段），不用字段注入。
- 读聚合根使用仓储端口方法并 `orElseThrow` 抛领域异常。

**注意事项**：

- 变更方法**必须**在同一事务内先读后改再保存；若读与写分离在两个事务，乐观锁会因版本过期频繁冲突。
- 幂等写入（如按业务键去重的入账）也应在此事务内"先查重 → 再变更 → 落幂等记录"，与乐观锁配合防重。
- 不要把 `@Transactional` 加在领域实体或仓储接口上——事务是应用服务的使用场景属性。

**历史可参考代码**（一般化表示）：

```java
@Service
@Transactional
public class <Entity>ApplicationService {
    private final <Entity>Repository repository;

    public <Entity> apply<BizAction>(String id, BigDecimal amount) {
        <Entity> entity = getById(id);
        entity.apply<BizAction>(amount);
        return repository.saveAccount(entity);
    }

    @Transactional(readOnly = true)
    public <Entity> getById(String id) {
        return repository.findByAccountId(id)
                .orElseThrow(() -> new NotFoundException("NOT_FOUND", "..."));
    }
}
```

**参考文件**：`AccountApplicationService.java`（新增文件，类级注解行 26-27；`getById` 行 38-43；`applyPosting` 行 56-60、`applyBillPayment` 行 62-66、`accrueInterest` 行 68-72、`creditCashback` 行 77-87）。

### 步骤 5：仓储端口与 JPA 适配器桥接

**实现逻辑**：在 domain 层定义仓储端口接口（纯接口、不依赖框架：`findByAccountId`/`saveAccount`/`findAllAccounts`），在 infrastructure 层用 Spring Data 接口实现并桥接：`AccountJpaRepository extends JpaRepository<Account, String>, AccountRepository`，用 `default` 方法把领域方法名映射到 Spring Data 内建方法（`findById`/`save`/`findAll`）。保持依赖倒置，domain 不感知持久化框架。

**规范约束**：

- 仓储端口放 `domain/repository`，实现放 `infrastructure/persistence`。
- 适配器接口同时继承 `JpaRepository<实体, 主键>` 与领域端口，`default` 方法做方法名桥接，避免在 domain 接口上引入框架注解。
- 一个聚合根对应一个仓储端口与一个 JPA 适配器。

**注意事项**：

- 桥接方法名要与 Spring Data 派生查询语义区分；`findByAccountId` 桥接到 `findById` 而不是同名派生查询。
- 不要为端口接口写实现类，Spring Data 接口代理即可。

**历史可参考代码**（一般化表示）：

```java
// domain/repository
public interface <Entity>Repository {
    Optional<<Entity>> findBy<IdName>(String id);
    <Entity> save<Entity>(<Entity> entity);
    List<<Entity>> findAll<Entities>();
}

// infrastructure/persistence
public interface <Entity>JpaRepository extends JpaRepository<<Entity>, String>, <Entity>Repository {
    @Override
    default Optional<<Entity>> findBy<IdName>(String id) { return findById(id); }
    @Override
    default <Entity> save<Entity>(<Entity> entity) { return save(entity); }
    @Override
    default List<<Entity>> findAll<Entities>() { return findAll(); }
}
```

**参考文件**：`AccountRepository.java`（新增文件，行 11-18）；`AccountJpaRepository.java`（新增文件，行 346-362）。

### 步骤 6：统一异常处理——乐观锁冲突映射为 409

**实现逻辑**：定义统一错误体 `ApiError(code, message, details)`（record + 静态工厂），用 `@RestControllerAdvice` 全局异常处理器把各类异常映射为 HTTP 语义：`NotFoundException` → 404、`BusinessRuleException` → 409、参数校验 `MethodArgumentNotValidException` → 400（details 汇总字段错误）、`OptimisticLockingFailureException` → 409 + `CONCURRENT_UPDATE` 错误码。乐观锁冲突文案沿用遗留系统提示语（如 "Record changed by some one else. Please review"），保持语义与用户习惯一致。

**规范约束**：

- 错误体统一 `{"code": "...", "message": "...", "details": [...]}` 结构（仓库 REST 约定 §4）。
- HTTP 语义固定：404 未找到、409 业务规则冲突、400 校验失败、409 并发冲突。
- 冲突错误码统一（如 `CONCURRENT_UPDATE`），全仓库一致。
- `@RestControllerAdvice` 处理器按异常类型分方法，不写巨型 if-else。

**注意事项**：

- `OptimisticLockingFailureException` 是 Spring Data 在 flush 时抛出的运行时异常，**必须**在全局处理器兜底，否则客户端收到 500 且无重试语义。
- 校验失败要汇总字段明细到 `details`，便于调用方定位；用 `bindingResult.getFieldErrors()` 流式映射。
- 错误码用大写蛇形、稳定可文档化（对应规则目录/API 文档）。

**历史可参考代码**（一般化表示）：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(OptimisticLockingFailureException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of("CONCURRENT_UPDATE",
                        "Record changed by some one else. Please review"));
    }
}
```

**参考文件**：`ApiError.java`（新增文件，行 11-16）；`GlobalExceptionHandler.java`（新增文件，行 36-65，乐观锁处理器行 60-65）。

### 步骤 7：响应 DTO 回传版本号支持重试闭环

**实现逻辑**：响应 DTO（record）包含 `version` 字段，用静态工厂 `from(实体)` 拷贝实体全部字段并携带 `account.getVersion()`。客户端获得最新版本号，冲突后可按"重新读取 → 携带新版本重试"闭环，或提示用户刷新。

**规范约束**：

- 请求/响应 DTO 用 Java `record`（仓库 REST 约定 §4）。
- 响应回传版本号，是乐观锁 API 契约的一部分，不可省略。
- 工厂方法 `from(entity)` 集中完成实体 → DTO 映射，Controller 不手写字段拷贝。

**注意事项**：

- 若更新请求允许携带期望版本号做前置校验，需在请求 DTO 中一并声明并在应用服务中比对（本案例为"事务内读取最新版本"模式，版本号仅用于响应与重试）。
- 金额字段在 DTO 中保持数值类型（`1940.00`），时间 ISO-8601 字符串，遵守仓库序列化约定。

**历史可参考代码**（一般化表示）：

```java
public record <Entity>Response(<Id> id, ... , long version) {
    public static <Entity>Response from(<Entity> entity) {
        return new <Entity>Response(entity.getId(), ..., entity.getVersion());
    }
}
```

**参考文件**：`AccountResponse.java`（新增文件，行 80-110，`version` 组件行 93，工厂行 95-110）。

### 步骤 8：领域行为单元测试

**实现逻辑**：为聚合根领域方法编写纯 JUnit（无 Spring 上下文）+ AssertJ 断言的单测：覆盖各类余额变更的数值方向（正负金额对余额/本期累计的影响）、业务规则拒绝路径（断言抛出 `BusinessRuleException` 且 `code` 正确）、参数边界。控制器层用 `@SpringBootTest` + MockMvc + H2 的端到端用例补充错误码与 HTTP 状态验证。

**规范约束**：

- 领域单测断言业务规则与错误码，不断言日志或实现细节（仓库测试约定 §7）。
- 金额断言用 `isEqualByComparingTo(...)`（BigDecimal 比较，不用 `equals`/`==`）。
- 异常断言用 AssertJ `assertThatThrownBy(...).isInstanceOf(...).extracting("code")...`。
- 每个服务至少"领域单测 + 一个 @SpringBootTest/MockMvc 端到端用例"（H2 + Flyway 迁移 + 种子数据）。

**注意事项**：

- 端到端用例直接依赖种子数据的账户与初始版本，测试间需注意账户余额状态可能被前序用例修改。
- 并发冲突路径的端到端模拟成本高，可用领域/仓储层测试代替；若需模拟可并发提交两个事务验证第二个失败。

**历史可参考代码**（一般化表示）：

```java
@Test
void <action>UpdatesBalanceAndCycleTotals() {
    Account account = new Account("<id>", details("<balance>"));
    account.apply<BizAction>(new BigDecimal("50.25"));
    assertThat(account.getCurrentBalance()).isEqualByComparingTo("150.25");
}

@Test
void <action>Rejects<RuleViolation>() {
    assertThatThrownBy(() -> account.apply<BizAction>(...))
            .isInstanceOf(BusinessRuleException.class)
            .extracting("code").isEqualTo("RULE_CODE");
}
```

**参考文件**：`AccountTest.java`（新增文件，测试辅助行 20-25；记账用例行 27-36、39-47；拒绝路径用例行 50-65、79-89、92-101）。

## 二、其他概念与最佳实践

- **乐观并发控制（OCC）**：假设冲突少，提交时校验版本。与悲观锁（`SELECT FOR UPDATE`）相比无锁等待、不易死锁、与数据库无关。冲突率高的热点账户可针对单账户记账退化为行锁短事务（ADR-006 回退路径），其余保持乐观锁。
- **丢失更新（Lost Update）问题**：无并发控制时，两个事务基于同一快照先后提交，后者静默覆盖前者。乐观锁使第二个提交失败而非覆盖，是余额/额度等不可合并字段的必须保障。
- **事务与实体生命周期**：`@Version` 冲突在 flush/提交阶段抛出——事务边界设计必须保证读、改、写同事务，且全局异常处理器兜底，业务代码保持干净。
- **充血模型与领域异常**：业务规则内聚在聚合根方法中，以 `BusinessRuleException(code, message)` 表达失败；错误码可追溯遗留规则编号（BR-/R-/NR-），支持审计与文档化。
- **依赖倒置与分层**：domain 定义仓储端口、infrastructure 用 Spring Data 实现，依赖方向 `interfaces → application → domain ← infrastructure`；domain 不依赖 Spring Web/JPA 注解之外的框架细节。
- **金额与日期建模**：金额一律 `BigDecimal`（DB `NUMERIC(12,2)`），日期 `LocalDate`，时间戳 `LocalDateTime`；遗留标识用零填充字符串（accountId 11 位等），禁止 `long` 丢失前导零。
- **DDL 与实体强一致**：`ddl-auto: validate` 下，实体新增列必须同步 Flyway 迁移脚本，否则启动失败；迁移脚本是表结构的唯一权威。
- **幂等与并发的配合**：跨服务入账/返现等场景用"业务键唯一表 + 事务内先查重后写入"实现幂等；与乐观锁并用时，重试方应重新读取最新版本。
- **可观测与运维**：服务暴露 `/actuator/health` 探针；日志不打印卡号、SSN、密码等敏感字段；版本冲突错误码稳定可被监控与告警消费。
