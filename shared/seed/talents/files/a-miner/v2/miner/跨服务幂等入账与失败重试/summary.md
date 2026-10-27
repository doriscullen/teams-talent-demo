# 跨服务幂等入账与失败重试开发范式总结

> 场景：跨服务奖励幂等入账 —— 实现跨服务奖励幂等入账，包含重复评估检查、账户入账去重、失败保留待处理状态及人工重试。
> 依据：`analyzer.md`（marketing-service 奖励发放 + account-service 幂等入账案例）与代码片段 01–03。

## 一、总体范式

| 维度 | 约定 |
|---|---|
| 架构 | 发起方（如营销/奖励服务）编排"业务记录 + 下游入账"；承接方（如账户服务）以业务幂等键提供幂等写入；两服务独立库、独立事务 |
| 一致性 | 无 MQ 时用"本地事务 + 同步调用 + 幂等键 + 人工重试"；下游失败不阻塞、不丢弃，保留待处理状态 |
| 幂等 | **两端各设一道**：发起方以业务自然键唯一约束（防重复评估/发奖）；承接方以业务幂等键（调用方生成的全局唯一 ID）做主键防重复入账；应用层先查后写 + 数据库约束并发兜底 |
| 失败处理 | 下游异常转领域异常（如 `RemoteServiceException`），事务 `noRollbackFor` 该异常以保留状态；记录转 PENDING + 失败原因；提供人工重试入口，重试幂等（已成功短路） |
| 分层 | interfaces → application → domain ← infrastructure（domain 无框架依赖）；仓储用端口接口 + 持久化实现桥接 |
| 金额/标识 | 全程 `BigDecimal(N,2)`，比较用 `compareTo/signum`；幂等键用 UUID 字符串（如 36 位）；时间 `LocalDateTime` + 注入 `Clock` |
| 并发 | 业务实体带 `@Version` 乐观锁；唯一约束/主键兜底并发竞态 |

## 二、实现步骤

### 步骤 1：建立幂等载体记录实体（发起方）

**实现逻辑**：新建"发奖/发放记录"实体，承载业务自然键、金额、状态机与失败原因；以自然键建数据库唯一约束，作为发起方幂等的最终保障。

**规范约束**：
- 表唯一键用业务自然键（如 `(campaign_id, transaction_id)`，命名 `uk_<表>_<键>`），同时建查询索引支持 exists/count。
- 状态机如 `PENDING → GRANTED / FAILED`，状态迁移封装为方法（markGranted/markPending/markFailed），维护 `failureReason`/`grantedAt` 等时间戳。
- 实体带 `@Version` 乐观锁列；金额列 `precision=12, scale=2`；标识列长度与遗留数据字典一致。
- 构造时做业务断言（如奖励必须 > 0），抛统一领域异常 `BusinessRuleException("CODE", "message")`。
- Flyway 迁移建表，表名小写下划线，`@Column` 与 SQL 字段一一对应。

**注意事项**：唯一约束与代码 `exists` 检查双保险——检查防重复、约束防并发竞态；状态方法幂等（重复 markGranted 不产生副作用）。

**历史参考代码（一般化）**：
```java
@Entity
@Table(name = "<发放记录表>", uniqueConstraints = @UniqueConstraint(name = "uk_<表>_<自然键>",
        columnNames = {"<业务键1>", "<业务键2>"}))
public class <发放记录> {
    @Id @Column(name = "record_id", length = 36, updatable = false) private String recordId;
    @Version @Column(name = "version") private long version;
    public void markGranted(LocalDateTime now) { status = GRANTED; grantedAt = now; failureReason = null; }
    public void markPending(String reason)      { status = PENDING; failureReason = reason; }
    public void markFailed(String reason)       { status = FAILED; failureReason = reason; }
}
```

**参考文件**：`RewardGrant.java` 全文件（重点 35–109 行）；`RewardStatus.java` 全文件；`V1__marketing_schema.sql` 490–510 行。

### 步骤 2：定义仓储端口与实现

**实现逻辑**：domain 层定义仓储接口（幂等检查、计数、按 ID 查询、保存），infrastructure 层以 Spring Data JPA 接口 + default 方法桥接派生查询，实现依赖倒置。

**规范约束**：
- 端口方法名语义化：`existsBy<自然键>(...)`、`countBy<维度>(...)`、`findBy<Id>`、`save<实体>`。
- 实现接口同时继承 `JpaRepository` 与端口接口，用 default 方法把语义名映射到派生查询，实体上不出现 Spring 注解。
- 分页/条件查询用 `JpaSpecificationExecutor` + 动态 `Predicate` 拼接。

**注意事项**：domain 接口不 import 任何 Spring 类；`@Version` 字段由 JPA 自动维护，仓储层无需处理。

**历史参考代码（一般化）**：
```java
public interface <实体>Repository {           // domain 端口
    Optional<X> findBy<Id>(String id);
    X save(X x);
    boolean existsBy<Key1>And<Key2>(String k1, String k2);
    long countBy<Dim>(String dim);
}
public interface <实体>JpaRepository extends JpaRepository<X, String>, <实体>Repository {  // infrastructure
    @Override default boolean existsBy<Key1>And<Key2>(String k1, String k2) {
        return existsBy<字段1>And<字段2>(k1, k2);
    }
    boolean existsBy<字段1>And<字段2>(String k1, String k2);  // Spring Data 派生
}
```

**参考文件**：`RewardGrantRepository.java` 全文件；`RewardGrantJpaRepository.java` 全文件。

### 步骤 3：编排业务逻辑（发起方应用服务）

**实现逻辑**：应用服务注入仓储端口、出站客户端与 `Clock`，按"校验 → 幂等检查 → 业务判定 → 建记录 → 调下游 → 落库"顺序编排；下游失败转待处理状态，不中断同批其他项；提供人工重试入口。

**规范约束**：
- 类级事务注解 `@Transactional(noRollbackFor = <远程异常>.class)`——下游失败时保留已保存的待处理记录，不回滚。
- 循环/批处理内单条不满足只记录跳过原因并 continue，不抛异常中断整批。
- 幂等：每项先 `existsBy<自然键>`，命中记 `ALREADY_*` 跳过；重复调用返回既有结果。
- 重试入口：先查记录，已成功（`isGranted()`）则短路返回；未成功且需调下游则重调（下游幂等键兜底），成功转 GRANTED，失败转 PENDING + 保存 + 抛异常（由 noRollbackFor 保留状态）。
- 参数校验放应用层入口（非空、位数格式、金额 > 0），失败抛 `InvalidRequestException`（400）；记录不存在抛 `NotFoundException`（404）。
- 时间源注入 `Clock`，统一 `LocalDateTime.now(clock)`，保证测试可控。

**注意事项**：外部调用放事务内是"同步方案"的明确取舍（长事务持锁），靠 noRollbackFor 保护；每个下游失败点都要 try/catch 转状态而非向上抛；`Clock` 统一时间戳避免测试不可控。

**历史参考代码（一般化）**：
```java
@Service
@Transactional(noRollbackFor = RemoteServiceException.class)
public class <编排服务> {
    public <结果> evaluate(<命令> cmd) {
        validate(cmd);
        for (<业务项> item : <repo>.findActiveAt(now)) {
            if (<repo>.existsBy<Key>(item.id, cmd.<业务id>())) { skipped(...ALREADY_*); continue; }
            // 业务判定：不满足 → skipped(reason)；满足 → 构造记录
            <记录> g = new <记录>(UUID.randomUUID().toString(), ..., now);   // 初始 PENDING
            try {
                <client>.<下游写入>(cmd.accountId(), g.getId(), item.id, g.getAmount());
                g.markGranted(now);
            } catch (RemoteServiceException ex) {
                g.markPending("...: " + ex.getMessage());
            }
            <repo>.save(g);
        }
    }
    public <视图> fulfill(String recordId) {   // 人工重试
        <记录> g = <repo>.find(recordId).orElseThrow(NotFoundException);
        if (!g.isGranted()) { try { <client>.<下游写入>(...); g.markGranted(now); }
            catch (RemoteServiceException ex) { g.markPending(ex.getMessage()); <repo>.save(g); throw ex; } }
        <repo>.save(g);
    }
}
```

**参考文件**：`RewardEvaluationService.java` 全文件（重点 58–142 行）；`EvaluationCommand.java`、`EvaluationOutcome.java` 全文件；`RewardController.java` 44–65 行。

### 步骤 4：编写下游出站适配器（发起方）

**实现逻辑**：封装对下游的 HTTP 调用，隔离传输细节：读接口区分"不存在（404→empty）"与"真实失败（非 2xx→领域异常）"；写接口 POST 携带幂等键与业务参数；网络异常统一包装为领域 `RemoteServiceException`。

**规范约束**：
- 用 `RestClient`（Spring Boot 3+），baseUrl 与超时由配置 Bean 装配（如 `@Qualifier` 命名客户端）。
- 读接口用 `exchange()` 手动分支状态码；写接口用 `retrieve()`，失败抛 `RestClientException` → 包装 `RemoteServiceException("下游名 unavailable/failed", ex)`。
- 请求/响应体用 record，内部私有 record 转换到领域模型。
- 幂等键作为写接口参数之一随请求传递（下游以其去重）。

**注意事项**：不要吞掉连接层异常信息；日志只含业务标识（如交易号/记录 ID），不打印卡号等敏感字段；超时时间需与下游 SLA 匹配（示例 3s）。

**历史参考代码（一般化）**：
```java
@Component
public class <下游>Client {
    private final RestClient restClient;
    public <下游>Client(@Qualifier("<下游>RestClient") RestClient restClient) { this.restClient = restClient; }

    public Optional<Snapshot> find(String id) {
        try {
            return restClient.get().uri("/api/v1/<资源>/{id}", id)
                .exchange((request, response) -> {
                    if (response.getStatusCode().value() == 404) return Optional.empty();
                    if (!response.getStatusCode().is2xxSuccessful())
                        throw new RemoteServiceException("HTTP " + response.getStatusCode().value());
                    return Optional.of(parse(response.getBody()));
                });
        } catch (RestClientException ex) { throw new RemoteServiceException("<下游> unavailable", ex); }
    }
    public void credit(String accountId, String idempotencyKey, BigDecimal amount) {
        try { restClient.post().uri("/api/v1/<资源>/{id}/<动作>", accountId)
                .body(new CreditBody(idempotencyKey, amount)).retrieve().toBodilessEntity(); }
        catch (RestClientException ex) { throw new RemoteServiceException("<下游> <动作> failed", ex); }
    }
}
```

**参考文件**：`AccountClient.java` 全文件；`RestClientConfig.java` 全文件。

### 步骤 5：下游提供幂等写入用例（承接方）

**实现逻辑**：承接方新增幂等写入用例：以调用方传入的业务幂等键先查后写——已存在则直接返回当前实体（不重复变更）；不存在则执行业务变更并记录"已处理"事实，两者在同一本地事务。

**规范约束**：
- 幂等表以幂等键为主键（如 `reward_credit(reward_id PK, ...)`）；重复调用 `existsBy<幂等键>` 命中直接返回。
- 业务变更封装在聚合根方法内（如 `applyCashback(amount)`：校验 > 0、余额语义注释说明方向）。
- 双写顺序：先业务实体后幂等记录（同一事务）——先记"已处理"后失败会残留假记录。
- 幂等键语义写进注释与需求文档（如 `NR-REWARD-01`），API 入参注解校验（`@NotBlank`/`@DecimalMin`）。

**注意事项**：幂等键由调用方生成并随请求传递（承接方不自己造键）；余额/金额增减方向与记账相反时避免符号错误；表名/字段与遗留数据字典对应。

**历史参考代码（一般化）**：
```java
@Service @Transactional
public class <承接>ApplicationService {
    public Account credit(String accountId, String idempotencyKey, BigDecimal amount) {
        if (<幂等表Repo>.existsBy<幂等键>(idempotencyKey)) return getById(accountId);   // 幂等
        Account account = getById(accountId);
        account.apply<动作>(amount);
        Account saved = accounts.saveAccount(account);
        <幂等表Repo>.save(new <幂等记录>(idempotencyKey, accountId, ..., amount, LocalDateTime.now()));
        return saved;
    }
}
```

**参考文件**：`AccountApplicationService.java` 71–87 行；`Account.java` 114–124 行；`RewardCredit.java` 全文件；`RewardCreditRepository.java` 全文件；`V3__reward_credit.sql` 全文件；`AccountController.java` 73–79 行。

### 步骤 6：数据库迁移（两端）

**实现逻辑**：发起方迁移建业务记录表（唯一约束 + 索引）；承接方迁移建幂等表（幂等键 PK + 查询索引）。Flyway 版本化演进。

**规范约束**：
- 表名小写下划线复数（如 `reward_grant`/`reward_credit`）；命名迁移 `V<N>__<主题>_schema.sql`。
- 唯一约束 `CONSTRAINT uk_<表>_<键> UNIQUE (...)`；查询索引 `CREATE INDEX idx_<表>_<列> ON <表> (<列>)`。
- 金额 `NUMERIC(12,2)`、标识 `VARCHAR(长度)` 与实体 `@Column` 一一对应；`@Version` 列 `BIGINT NOT NULL DEFAULT 0`。

**注意事项**：H2 单测与 PostgreSQL 双跑迁移，保证语法兼容；约束名全局唯一避免迁移冲突。

**参考文件**：`V1__marketing_schema.sql` 490–510 行；`V3__reward_credit.sql` 全文件。

### 步骤 7：测试覆盖幂等与失败路径

**实现逻辑**：承接方用 `@SpringBootTest` + MockMvc 端到端验证"同一幂等键重复调用只变更一次"（真实约束生效）；发起方用 Mockito 桩仓储与客户端验证发奖、PENDING、幂等跳过与重试。

**规范约束**：
- 幂等断言：重复调用后状态/余额不变；`verify(repo, never()).save(...)`（重复评估不保存）。
- 失败分支：`doThrow(RemoteServiceException)` → 断言记录为 PENDING 且含原因；重试成功转 GRANTED。
- 固定 `Clock`（如 `Clock.fixed(...)`）；金额断言 `isEqualByComparingTo`。
- 应用测试 `@ExtendWith(MockitoExtension.class)` + `@Mock` 端口；端到端 `@ActiveProfiles("test")`。

**注意事项**：不断言日志或实现细节；测试不得依赖外部网络/其他服务；验证 `never()` 也要验证确实发生了主路径调用（防止桩漏配导致假绿）。

**参考文件**：`RewardEvaluationServiceTest.java` 全文件（重点 220–307 行）；`AccountControllerTest.java` 86–104 行。

## 三、其他概念与最佳实践

- **跨服务一致性的三种选择**：方案 A 本地事务 + 同步调用 + 幂等键 + 人工重试（无中间件、链路短、下游失败不影响主链路）；方案 B Outbox + MQ（彻底解耦、可重放，成本高）；方案 C 日终批量（简单但非实时）。幂等键设计应同时服务同步重试与未来事件重放，避免返工。
- **失败域分离**：资金/账务事实与附加权益（营销奖励、通知等）失败域必须分离——附加调用失败只告警不回滚；下游失败保留待处理状态可重试。
- **幂等三层保障**：应用层先查后写 → 数据库唯一约束/主键（并发兜底）→ 重试入口短路（已成功不重复调用）。
- **乐观锁**：业务实体带 `@Version`，替代遗留"读-改-写 + 人工比对"；极端并发下资源类计数（如预算）可能超发，需对账。
- **统一异常与错误体**：参数错 `InvalidRequestException`(400)、记录不存在 `NotFoundException`(404)、下游不可用 `RemoteServiceException`(503)；错误响应 `{"code","message","details"}`；HTTP 语义 400/404/409/503。
- **标识与金额约定**：遗留系统标识用零填充定长字符串（如交易号 16 位、卡号 16 位、账户 11 位）；金额 `BigDecimal`，禁止 `double`；时间 `LocalDateTime`，注入 `Clock`。
- **可观测性与回退**：日志只含业务标识不打印敏感字段；提供配置开关整体关闭下游集成（如 `marketing.enabled`）；待处理记录提供查询与管理入口（运营可人工重试）。
- **测试分层**：纯领域单测（无 Spring）+ 应用层 Mockito 单测（桩端口/客户端）+ `@SpringBootTest`/MockMvc 端到端（真实约束）+ H2 双跑迁移。
