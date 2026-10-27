# 用户维护与删除保护：开发范式总结

> 一般性场景：实现用户新增、修改与删除，包含用户类型校验、密码哈希处理、禁止自删除及保留最后一名管理员。

## 一、实现步骤

### 步骤 1：定义聚合根实体与值对象，收敛字段校验

**实现逻辑**：为被维护的领域对象建立 `@Entity` 聚合根（如 `User`），字段与数据库表一一对应（主键即业务键、定长字符串标识、`@Version` 乐观锁列）；把可维护字段组装为值对象 record（如 `UserDetails`）。所有字段级业务校验（标识格式、长度上限、枚举取值、trim 规范化）以 `require*` 私有方法形式写在聚合根构造与更新方法内，Service 不再堆 setter。对"比较前统一规范化"的字段（如用户号 trim + 大写）提供静态归一化方法，供登录、维护等多个用例复用。

**规范约束**：

- 充血模型：校验与变更行为写在实体上；实体字段全部私有，行为经公开方法暴露（仓库 Java 约定 §3）。
- 标识保持遗留定长字符串：如用户号 `VARCHAR(8)`，正则 `^[A-Z0-9]{8}$`，绝不改用 `long` 以免丢前导零。
- 实体构造时显式初始化 `version = 0`，与 DDL `DEFAULT 0` 对齐（ADR-006 乐观锁基线）。
- 值对象用 Java record，字段与请求 DTO 保持同构，作为 DTO → 聚合根的传递载体。

**注意事项**：

- 归一化用 `toUpperCase(Locale.ROOT)` 而非默认 locale，避免土耳其语环境 `i → İ` 等大小写陷阱。
- 归一化只应用于标识与枚举，**不要**作用于密码（密码按原样 trim + 哈希，见 ADR-008 案例）。
- 校验失败抛领域校验异常（`ValidationException(field, message)`，details 为 `字段: 消息` 列表），不要在实体里返回错误码或布尔值。
- 枚举（如用户类型 A/U）trim + 大写后严格白名单，不能只做非空校验（遗留仅非空校验属缺陷，本范式修正）。

**历史可参考代码**（一般化表示）：

```java
@Entity
@Table(name = "<table>")
public class <AggregateRoot> {
    public static final String TYPE_<X> = "X";

    @Id
    @Column(name = "<id>", length = <n>, nullable = false, updatable = false)
    private String <id>;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected <AggregateRoot>() { /* for JPA */ }

    public <AggregateRoot>(String <id>, <Details> details, ...) {
        this.<id> = require<Id>(<id>);
        applyDetails(details);
        this.version = 0;
    }

    /** 比较前统一规范化：trim + 大写 */
    public static String normalize<Id>(String raw) {
        return raw == null ? null : raw.trim().toUpperCase(Locale.ROOT);
    }

    public void applyDetails(<Details> details) {
        // requireName / requireType 等逐字段校验后赋值
    }

    private static String require<Id>(String raw) {
        String normalized = normalize<Id>(raw);
        if (normalized == null || !PATTERN.matcher(normalized).matches()) {
            throw new ValidationException("<id>", "<Id> must ...");
        }
        return normalized;
    }
}
```

**参考文件**：`User.java`（新增文件，内容起始行 137、终止行 291；`normalizeUserId` 行 203-205、`applyDetails` 行 210-217、`requireUserId` 行 240-246）、`UserDetails.java`（新增文件，行 297-304）。

### 步骤 2：定义密码哈希端口并实现，密码永不明文存储

**实现逻辑**：在 domain 层声明哈希端口（`hash`/`verify` 两个方法），把算法决策隔离在端口之后；infrastructure 层用 JDK 内置 `SecretKeyFactory("PBKDF2WithHmacSHA256")` 实现：每用户 `SecureRandom` 生成 16 字节盐、迭代 210000 次、编码为自包含格式 `pbkdf2$<iterations>$<saltBase64>$<hashBase64>`（verify 时从编码串解析迭代次数与盐，用 `MessageDigest.isEqual` 常量时间比较防时序侧信道）。用例服务在写库前调用 `hash(requirePassword(raw))`，实体只保存/接收已哈希值。

**规范约束**：

- 密码长度与空白规则收敛在应用层（如 `requirePassword`：先判空 → trim → 再查 8-64 位，避免纯空白通过长度检查）。
- 实体与响应 DTO 不得出现明文密码字段；响应 DTO 连哈希字段也不暴露（数据最小化）。
- 哈希算法优先 JDK 内置，避免引入安全框架依赖（本项目 ADR-008 决策背景）。
- 密钥规格（`PBEKeySpec`）使用后 `clearPassword()` 清理内存副本。

**注意事项**：

- 更新场景密码"可省略"时，用 `password == null` 语义（而非空串）表示"保持原哈希"，只在非 null 时调用 `changePassword`。
- 登录与维护共享同一 `verify`/归一化语义，避免两端规则漂移（本项目登录同样 trim 密码）。
- 种子数据（Flyway INSERT）只写预生成哈希，注释中可标注演示明文，但库内不得有明文。

**历史可参考代码**（一般化表示）：

```java
public interface PasswordHasher {
    String hash(String rawPassword);
    boolean verify(String rawPassword, String encodedPassword);
}

@Component
public class Pbkdf2PasswordHasher implements PasswordHasher {
    public String hash(String rawPassword) {
        byte[] salt = new byte[SALT_BYTES]; random.nextBytes(salt);
        byte[] derived = derive(rawPassword, salt, ITERATIONS);
        return PREFIX + SEPARATOR + ITERATIONS + SEPARATOR
                + encoder.encodeToString(salt) + SEPARATOR + encoder.encodeToString(derived);
    }
    // verify: 解析编码串 → derive → MessageDigest.isEqual 常量时间比较
}
```

**参考文件**：`PasswordHasher.java`（新增文件，行 340-356）、`Pbkdf2PasswordHasher.java`（既有文件，行 1-72，编码格式注释行 14-17、`hash` 行 31-38、`verify` 行 41-58）。

### 步骤 3：定义仓储端口并由 Spring Data JPA 适配实现

**实现逻辑**：domain 层声明仓储纯接口（按用例需要列出方法：按业务键查找、存在性判断、保存、分页列表、计数、删除），不依赖任何框架类型；infrastructure 层让 Spring Data 接口同时继承 `JpaRepository` 与领域端口，用 default 方法把领域方法桥接到 Spring Data API（`findById`/`save`/`count`/`deleteById`），查询条件（排序、分页）写在适配层（如 `PageRequest.of(page, size, Sort.by(ASC, "<id>"))`），简单计数/存在判断用派生查询自动实现。

**规范约束**：

- 领域端口方法命名贴近用例语义（`findByXxx`/`saveXxx`/`countByType`/`deleteXxx`），而非框架 API 直译。
- 分页排序需求（如按业务键升序）在适配层显式声明，由应用层调用时不再处理排序细节。
- 端口不得泄漏 JPA/Spring 类型（如不返回 `Page<T>`，用领域分页载体或 `List`）。

**注意事项**：

- 判重优先用 `existsByUserId` 先查后写（返回 409 语义明确），而不是依赖主键冲突异常做控制流。
- 计数方法（如 `countByUserType`）是"最后一名管理员"等保护规则的判断基础，必须由端口提供并能在事务内与后续写入保持同一事务。
- 适配层方法无业务逻辑，全部委托 Spring Data。

**历史可参考代码**（一般化表示）：

```java
public interface <Entity>Repository {
    Optional<<Entity>> findBy<Id>(String <id>);
    boolean existsBy<Id>(String <id>);
    <Entity> save<Entity>(<Entity> entity);
    List<<Entity>> findAll(int page, int size);   // 按业务键升序
    long count();
    long countBy<Field>(String value);
    void delete(String <id>);
}

public interface <Entity>JpaRepository extends JpaRepository<<Entity>, String>, <Entity>Repository {
    long countBy<Field>(String value);
    @Override
    default Optional<<Entity>> findBy<Id>(String <id>) { return findById(<id>); }
    @Override
    default List<<Entity>> findAll(int page, int size) {
        return findAll(PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "<id>"))).getContent();
    }
}
```

**参考文件**：`UserRepository.java`（新增文件，行 305-339）、`UserJpaRepository.java`（既有文件，行 1-42，`findAllUsers` 行 29-31、`countByUserType` 行 14）。

### 步骤 4：实现用例服务，界定事务边界并编排"读-判-改-存"

**实现逻辑**：创建 `@Service` 用例类，类级 `@Transactional` 界定事务边界，查询方法加 `@Transactional(readOnly = true)`。每个变更用例按固定顺序编排：`get`（读聚合根，未找到抛 `NotFoundException(code, message)`）→ 业务规则判定（唯一性、保护规则等，失败抛 `BusinessRuleException(code, message)`）→ 调用领域方法变更 → `save` 持久化。构造器注入仓储端口与端口服务（如 `PasswordHasher`），字段全部 `private final`。

**规范约束**：

- 事务边界在应用服务层，不放在 Controller 或仓储（仓库分层规范：`interfaces → application → domain ← infrastructure`）。
- 分页参数在应用层做防御：page < 0 归 0、size ≤ 0 取默认、超上限截断（默认与上限作为类常量）。
- 写入类方法不标 `readOnly`；读写混用方法按可写处理。
- 领域异常在应用层抛出，由全局异常处理器统一映射 HTTP 语义，Service 不处理 HTTP。

**注意事项**：

- "先查后判再写"必须在**同一事务**内完成，保证判定（如管理员计数）与写入原子。
- 唯一性判定（`existsByUserId` → 409 USER_ALREADY_EXISTS）属于跨实体约束，放应用层而非实体。
- 读聚合根用 `orElseThrow` 抛领域异常，错误码大写蛇形（如 `USER_NOT_FOUND`）。

**历史可参考代码**（一般化表示）：

```java
@Service
@Transactional
public class <Entity>DirectoryService {
    private static final int DEFAULT_PAGE_SIZE = 10;
    private static final int MAX_PAGE_SIZE = 100;

    private final <Entity>Repository entities;
    private final PasswordHasher passwordHasher;

    @Transactional(readOnly = true)
    public PageResult<<Entity>> list(int page, int size) {
        int safePage = page < 0 ? 0 : page;
        int safeSize = size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        return new PageResult<>(entities.findAll(safePage, safeSize), safePage, safeSize, entities.count());
    }

    public <Entity> create(String raw<Id>, <Details> details, String password) {
        <Entity> entity = new <Entity>(raw<Id>, details, passwordHasher.hash(requirePassword(password)));
        if (entities.existsBy<Id>(entity.get<Id>())) {
            throw new BusinessRuleException("ALREADY_EXISTS", "... already exists");
        }
        return entities.save(entity);
    }

    public <Entity> update(String raw<Id>, <Details> details, String password) {
        <Entity> entity = get(raw<Id>);
        entity.applyDetails(details);                    // 领域方法变更
        if (password != null) {
            entity.changePassword(passwordHasher.hash(requirePassword(password)));
        }
        return entities.save(entity);
    }

    public void delete(String raw<Id>, String actingUserId) {
        <Entity> entity = get(raw<Id>);
        // 保护规则判定（步骤 5）
        entities.delete(entity.get<Id>());
    }
}
```

**参考文件**：`UserDirectoryService.java`（新增文件，行 1-130；`list` 行 41-47、`create` 行 60-67、`update` 行 73-86、`delete` 行 91-103、`requirePassword` 行 120-129）。

### 步骤 5：实现删除/降级保护规则（禁止自删除、保留最后一名管理员）

**实现逻辑**：对"删除/降级"类破坏性操作叠加两条保护：① 自删除保护——把操作者身份（如请求头 `X-User-Id`）经与标识相同的归一化后与被操作对象比较，相等即拒绝（错误码如 `CANNOT_DELETE_SELF`）；② 最后一名管理员保护——判断被操作对象是否属于特权类型（如管理员），若是则计数同类特权对象，`count <= 1` 时拒绝删除或降级（错误码如 `LAST_ADMIN`）。两条规则都在应用层、保存/删除动作之前、同一事务内判定。操作者身份以可选参数传入（如 Controller 读取可选请求头），null 时跳过自删除判定。

**规范约束**：

- 保护判定顺序固定：先自删除/身份判定，再最后一名判定（错误码优先级可被测试断言，顺序敏感）。
- 特权计数用端口方法（`countByType(TYPE_X) <= 1`），不在应用层重复查询逻辑。
- 降级判定条件是"当前是特权类型 && 目标类型不是特权类型"，只有真正改变特权状态才触发保护。
- 错误码与文案语义明确：`LAST_ADMIN`（"Cannot demote/delete the last administrator"）、`CANNOT_DELETE_SELF`。

**注意事项**：

- 操作者身份先归一化再比较（大小写/空白不一致会误伤或漏判）；`null`/缺失时按"非本人"处理，不阻断。
- 规则必须在与写操作相同的事务与进程内判定，不能跨事务快照计数。
- 这类规则遗留系统通常缺失（历史缺陷），实现时需以"新增防护规则"（NR-*）形式显式登记到规则目录，并配正反路径测试。

**历史可参考代码**（一般化表示）：

```java
public void delete(String raw<Id>, String actingUserId) {
    <Entity> entity = get(raw<Id>);
    String actor = <Entity>.normalize<Id>(actingUserId);
    if (actor != null && actor.equals(entity.get<Id>())) {
        throw new BusinessRuleException("CANNOT_DELETE_SELF", "You cannot delete your own record.");
    }
    if (entity.is<Privileged>() && isLast<Privileged>()) {
        throw new BusinessRuleException("LAST_<PRIVILEGED>", "Cannot delete the last <privileged>.");
    }
    entities.delete(entity.get<Id>());
}

public <Entity> update(String raw<Id>, <Details> details, String password) {
    <Entity> entity = get(raw<Id>);
    boolean demoting = entity.is<Privileged>()
            && !TYPE_<X>.equals(details == null ? null : details.<type>());
    if (demoting && isLast<Privileged>()) {
        throw new BusinessRuleException("LAST_<PRIVILEGED>", "Cannot demote the last <privileged>.");
    }
    entity.applyDetails(details);
    ...
}

private boolean isLast<Privileged>() {
    return entities.countBy<Type>(<Entity>.TYPE_<X>) <= 1;
}
```

**参考文件**：`UserDirectoryService.java`（`delete` 行 91-103、`update` 行 73-86、`isLastAdmin` 行 105-107）。

### 步骤 6：实现 REST 适配层（Controller + 请求/响应 DTO）

**实现逻辑**：创建 `@RestController @RequestMapping("/api/v1/<resources>")`，每个资源方法只做三件事：参数绑定与校验（`@Valid`）、调用用例服务、把领域对象映射为响应 DTO（`XxxResponse.from(entity)`）。请求 DTO 用 record + Jakarta Bean Validation 注解（`@NotBlank`/`@NotNull`/`@Size`/`@Pattern`）+ `@Schema` 文档注解；`toDetails()` 方法把校验后的请求字段组装为领域值对象。响应 DTO 静态工厂 `from` 只挑选安全字段，**刻意剔除敏感字段**（密码、哈希、卡号 CVV 等）。删除等操作的操作者身份经可选请求头（如 `X-User-Id`，`required = false`）传入。

**规范约束**：

- 基础路径 `/api/v1/<资源复数>`（仓库 REST 约定）；列表统一 `{"items": [...], "page", "size", "total"}` 结构。
- 请求/响应 DTO 一律 record；请求 DTO 校验注解文案与领域层校验文案保持一致。
- Controller 不含业务逻辑，不做手工校验；HTTP 语义交给全局异常处理器（400/404/409/201/204）。
- `@Valid` 只校验请求体；路径变量与查询参数的基础格式（如正则）可放 DTO 或参数注解。
- 创建返回 `201 CREATED` + 响应体；删除返回 `204 NO_CONTENT`。

**注意事项**：

- 响应 DTO 必须显式列出字段，不能直接序列化实体（否则敏感字段泄漏）；测试断言 `passwordHash` 不存在。
- 更新请求的"可选字段"（如 password）不要加 `@NotBlank`，只加存在时校验的约束（`@Size`）。
- 请求 DTO 校验是"格式层"，领域校验是"语义层"，两者都通过才算合法输入（本项目测试同时断言 400 details 与领域 400 文案一致）。

**历史可参考代码**（一般化表示）：

```java
@RestController
@RequestMapping("/api/v1/<resources>")
public class <Entity>Controller {
    private static final String ACTING_USER_HEADER = "X-User-Id";

    private final <Entity>DirectoryService service;

    @GetMapping
    public PageResponse<<Entity>Response> list(@RequestParam(defaultValue = "0") int page,
                                               @RequestParam(defaultValue = "10") int size) {
        PageResult<<Entity>> result = service.list(page, size);
        return new PageResponse<>(result.items().stream().map(<Entity>Response::from).toList(),
                result.page(), result.size(), result.total());
    }

    @PostMapping
    public ResponseEntity<<Entity>Response> create(@Valid @RequestBody CreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(<Entity>Response.from(
                service.create(request.<id>(), request.toDetails(), request.password())));
    }

    @DeleteMapping("/{<id>}")
    public ResponseEntity<Void> delete(@PathVariable String <id>,
                                       @RequestHeader(name = ACTING_USER_HEADER, required = false)
                                       String actingUserId) {
        service.delete(<id>, actingUserId);
        return ResponseEntity.noContent().build();
    }
}
```

**参考文件**：`UserController.java`（新增文件，行 1-76；list 行 44-50、create 行 57-61、delete 行 69-75）、`CreateUserRequest.java`（行 77-127）、`UpdateUserRequest.java`（行 128-164）、`UserResponse.java`（行 165-185）。

### 步骤 7：确认统一错误映射与 HTTP 语义

**实现逻辑**：由 `@RestControllerAdvice` 全局异常处理器统一映射领域异常为 HTTP 响应：`ValidationException`（含 Bean Validation 的 `MethodArgumentNotValidException`）→ 400，`NotFoundException` → 404，`BusinessRuleException` → 409，`OptimisticLockingFailureException` → 409（沿用遗留冲突文案）。响应统一为 `ApiError{code, message, details}`，details 为 `字段: 消息` 列表。错误码约定：业务场景大写蛇形（`USER_ALREADY_EXISTS`/`LAST_ADMIN`），未找到 `*_NOT_FOUND`。

**规范约束**：

- 错误响应结构全仓库统一（仓库 Java 约定 §4）；领域异常构造即携带 code。
- 400 的 details 由 `BindingResult` 字段错误映射生成，与领域 `ValidationException` 的 details 同构。
- 领域异常不携带 HTTP 概念（状态码只在异常处理器出现）。

**注意事项**：

- Bean Validation 失败的 code 固定为 `VALIDATION_FAILED`；领域校验失败 code 可为 `VALIDATION_FAILED` + details。
- 乐观锁冲突必须兜底（异常在 flush/提交时抛出，业务代码不 try-catch）。

**历史可参考代码**（一般化表示）：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(ex.getCode(), ex.getMessage()));
    }
    @ExceptionHandler(BusinessRuleException.class)
    public ResponseEntity<ApiError> handleBusinessRule(BusinessRuleException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(ex.getCode(), ex.getMessage()));
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        List<String> details = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getField() + ": " + e.getDefaultMessage()).toList();
        return ResponseEntity.badRequest().body(new ApiError("VALIDATION_FAILED", "...", details));
    }
}
```

**参考文件**：`GlobalExceptionHandler.java`（既有文件，行 1-58；404 行 25-29、409 行 31-35、400 行 43-50、乐观锁 行 52-57）、`ApiError.java`（既有文件，行 1-10）。

### 步骤 8：编写数据库脚本与种子数据

**实现逻辑**：Flyway 迁移脚本建表，列定义与实体注解严格一致（长度、非空、`version BIGINT NOT NULL DEFAULT 0`）；种子脚本写入演示/测试基线数据，敏感字段（密码）只写预生成哈希。`ddl-auto: validate` 配置下实体与 DDL 不一致会导致启动失败，因此新增实体字段必须同步迁移脚本。

**规范约束**：

- 表名小写下划线，字段与遗留 copybook 一一对应（仓库数据库约定）；每个聚合表带 `version`。
- 种子 INSERT 幂等、显式列出全部列，便于 H2 与 PostgreSQL 双跑。
- 测试 profile 复用同一迁移脚本（H2 + Flyway）。

**注意事项**：

- 种子用户的密码哈希与测试断言的 `pbkdf2$210000$` 前缀一致，测试依赖种子基线（如 total=2）。
- 测试用例尽量自含（先造数据再删），减少对种子的顺序依赖。

**历史可参考代码**（一般化表示）：

```sql
CREATE TABLE <entity_table> (
    <id>          VARCHAR(<n>)   PRIMARY KEY,
    <field1>      VARCHAR(<n>)   NOT NULL,
    ...
    password_hash VARCHAR(200)   NOT NULL,
    <type>        VARCHAR(1)     NOT NULL,
    version       BIGINT         NOT NULL DEFAULT 0
);

INSERT INTO <entity_table> (<id>, ..., password_hash, <type>, version)
VALUES ('<SEED>', ..., '<pbkdf2$iter$salt$hash>', 'X', 0);
```

**参考文件**：`V1__iam_schema.sql`（既有文件，行 1-8）、`V2__iam_seed.sql`（既有文件，行 1-9）。

### 步骤 9：编写应用层与 REST 层测试

**实现逻辑**：测试分两层：① 应用层 `@SpringBootTest`（`@ActiveProfiles("test") @Transactional`）直接注入用例服务，用 AssertJ 断言领域行为——每条业务规则的通过与拒绝路径（重复、枚举、长度、自删除、最后一名管理员删除/降级、密码保持与替换）、密码哈希回验（`verify` 原文可验、哈希前缀断言）、分页排序与计数；② REST 层 `@SpringBootTest + @AutoConfigureMockMvc` 用 MockMvc 断言 HTTP 语义与错误码（200/201/204/400/404/409）及响应字段最小化（`doesNotExist` 敏感字段）。

**规范约束**：

- 断言重点在业务规则与错误码，不断言日志或实现细节（仓库测试约定）。
- 拒绝路径断言 `assertThatThrownBy(...).isInstanceOf(...).extracting("code")`。
- 端到端用例必须本地可跑（H2 + Flyway + 种子），不依赖外部服务。

**注意事项**：

- 保护规则顺序敏感（自删除优先于最后一名），测试要覆盖两种优先级场景。
- 测试数据自含原则：先通过 update 造出第二个管理员再验证可删除，避免用例间依赖。
- 同一 service 测试与 controller 测试共享种子基线，删除类用例注意事务回滚隔离（`@Transactional` 测试回滚）。

**历史可参考代码**（一般化表示）：

```java
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class <Entity>DirectoryServiceTest {
    @Autowired private <Entity>DirectoryService service;

    @Test
    void refusesToDeleteLast<Privileged>() {
        assertThatThrownBy(() -> service.delete("ADMIN001", "USER0001"))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("LAST_ADMIN");
    }

    @Test
    void keepsPasswordWhenUpdateOmitsIt() {
        String originalHash = service.get("USER0001").getPasswordHash();
        User renamed = service.update("USER0001", new <Details>("Demo", "Tester", "U"), null);
        assertThat(renamed.getPasswordHash()).isEqualTo(originalHash);
    }
}
```

**参考文件**：`UserDirectoryServiceTest.java`（新增文件，行 1-146；最后管理员行 104-108、密码保持行 126-141）、`UserControllerTest.java`（既有文件，行 1-210；自删除 409 行 184-189、响应无密码字段行 96-106、创建 201 行 123-138）。

## 二、其他相关概念与知识

- **领域知识（遗留迁移）**：本范式是"COBOL 屏幕程序 → REST CRUD"迁移的典型形态。业务规则目录（`docs/legacy/03-business-rule-catalog.md`）把每条规则标注遗留证据（程序/段落/行号）→ 目标落点 → 实现状态，迁移实现必须可追溯（BR-USER-*、NR-USER-*）；新增防护规则以 NR-* 登记。traceability matrix（`docs/design/06-traceability-matrix.md`）记录"遗留程序 → 服务 → 接口 → 规则 → 测试"全链路。
- **系统知识（标识与协议）**：遗留标识一律零填充定长字符串（8/9/11/16 位），业务键即主键，接口按字符串协议传输；日期用 `LocalDate`/ISO-8601，金额用 `BigDecimal`，状态码保持遗留取值（A/U、Y/N）。`@Version` 乐观锁替换遗留 `READ UPDATE` + 快照比对（ADR-006），冲突 409。
- **安全知识**：密码存储遵循 ADR 决策（PBKDF2 + 每用户盐 + 自包含编码）；登录失败统一错误语义防用户枚举；响应数据最小化（敏感字段绝不外泄）；常量时间比较防时序攻击；口令副本用后清除。
- **编码行为**：请求校验分三层（REST 格式 Bean Validation / 领域语义 / 应用跨实体），文案跨层一致；错误码大写蛇形、可被测试断言；事务边界只在应用层；Controller 瘦、Service 编排、Domain 充血、Infrastructure 适配。
- **最佳实践**：用例类构造器注入（`private final`）；分页参数防御式归一；保护类业务规则必须配正反路径测试；测试用例自含、基于种子基线、事务回滚隔离。

## 三、参考文件清单

| 步骤 | 参考文件 | 内容行 |
|---|---|---|
| 1 | `User.java`（新增） | 137-291 |
| 1 | `UserDetails.java`（新增） | 297-304 |
| 2 | `PasswordHasher.java`（新增） | 340-356 |
| 2 | `Pbkdf2PasswordHasher.java`（既有） | 1-72 |
| 3 | `UserRepository.java`（新增） | 305-339 |
| 3 | `UserJpaRepository.java`（既有） | 1-42 |
| 4 | `UserDirectoryService.java`（新增） | 1-130 |
| 5 | `UserDirectoryService.java`（delete/update/isLastAdmin） | 73-107 |
| 6 | `UserController.java`（新增） | 1-76 |
| 6 | `CreateUserRequest.java`（新增） | 77-127 |
| 6 | `UpdateUserRequest.java`（新增） | 128-164 |
| 6 | `UserResponse.java`（新增） | 165-185 |
| 7 | `GlobalExceptionHandler.java`（既有） | 1-58 |
| 7 | `ApiError.java`（既有） | 1-10 |
| 8 | `V1__iam_schema.sql`（既有） | 1-8 |
| 8 | `V2__iam_seed.sql`（既有） | 1-9 |
| 9 | `UserDirectoryServiceTest.java`（新增） | 1-146 |
| 9 | `UserControllerTest.java`（既有） | 1-210 |
