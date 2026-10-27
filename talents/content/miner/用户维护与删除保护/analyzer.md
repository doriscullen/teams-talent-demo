# 用户维护与删除保护（iam-service 用户目录 CRUD）代码分析报告

## 仓库知识层次分类

- **仓库**：`carddemo-java-1025`，银行信用卡演示系统的微服务仓库（Maven 多模块，父 POM `com.carddemo:carddemo-java`）。每个服务独立构建、独立数据库，分层基线见 `docs/design/07-java-conventions.md`。
- **需求影响的子系统**：iam-service（身份与访问上下文，端口 8081）。该服务承载遗留安全域（登录 COSGN00C、用户目录维护 COUSR00C/01C/02C/03C）的迁移。
- **层次定位**（依赖方向 `interfaces → application → domain ← infrastructure`）：
  - `interfaces/rest`：`UserController`（入站适配器，REST 映射与请求校验）及其 DTO（`CreateUserRequest`/`UpdateUserRequest`/`UserResponse`/`PageResponse`）。
  - `application`：`UserDirectoryService`（用例编排与事务边界）、`PageResult`（分页载体）。
  - `domain/model`：`User`（聚合根，充血模型）、`UserDetails`（可维护字段值对象 record）。
  - `domain/repository`：`UserRepository`（仓储端口，纯接口不依赖框架）。
  - `domain/security`：`PasswordHasher`（密码哈希端口）。
  - `domain/exception`：`BusinessRuleException`/`NotFoundException`/`ValidationException`。
  - `infrastructure/persistence`：`UserJpaRepository`（Spring Data JPA 适配实现端口）。
  - `infrastructure/security`：`Pbkdf2PasswordHasher`（PBKDF2 实现）。
  - `interfaces/rest`：`GlobalExceptionHandler` + `ApiError`（统一错误响应）。
- 需求影响的核心对象：`User` 聚合根 → `UserDirectoryService` 用例 → `UserController` REST 入口，贯穿四层。

## 需求影响位置依赖分析

| 依赖 | 类型 | 产生原因与位置 |
|---|---|---|
| `UserController` → `UserDirectoryService` | 导入 + 构造器注入调用 | Controller 是唯一入站入口，通过构造器注入用例服务（`UserController.java:40-42`），将 HTTP 请求翻译为用例调用并做响应 DTO 映射 |
| `UserDirectoryService` → `UserRepository` | 导入 + 构造器注入调用 | 用例依赖仓储端口读写聚合根（`UserDirectoryService.java:33-36`），不直接依赖 JPA |
| `UserDirectoryService` → `User` / `UserDetails` | 导入 + 调用 | 用例编排领域行为：构造 `User`、调用 `applyDetails`/`changePassword`、读取 `isAdmin()`/`getUserId()` |
| `UserDirectoryService` → `PasswordHasher` | 导入 + 构造器注入调用 | 密码哈希端口，创建/修改密码时调用 `hash()`（`UserDirectoryService.java:61,83`） |
| `User` → `UserDetails` | 导入 + 调用 | 聚合根通过 `applyDetails(details)` 吸收可维护字段（`User.java:210-217`） |
| `UserRepository` → `UserJpaRepository` | 接口实现关系 | `UserJpaRepository extends JpaRepository<User, String>, UserRepository`（`UserJpaRepository.java:12`），JPA 派生查询 `countByUserType`/`existsByUserId` 自动实现端口方法，`findAllUsers` 用 `PageRequest.of(page, size, Sort.by(ASC, "userId"))` |
| `PasswordHasher` → `Pbkdf2PasswordHasher` | 接口实现关系 | `Pbkdf2PasswordHasher implements PasswordHasher`（`Pbkdf2PasswordHasher.java:19`），编码格式 `pbkdf2$<iterations>$<salt>$<hash>` |
| 领域异常 → `GlobalExceptionHandler` | 导入 + 处理 | `@RestControllerAdvice` 将 `NotFoundException`→404、`BusinessRuleException`→409、`ValidationException`→400、`MethodArgumentNotValidException`→400、`OptimisticLockingFailureException`→409（`GlobalExceptionHandler.java:19-57`） |
| DTO `CreateUserRequest`/`UpdateUserRequest` → `UserDetails` | 导入 + 调用 | 请求 DTO 提供 `toDetails()` 把 bean 校验后的字段组装为领域值对象（`CreateUserRequest.java:124-126`） |
| DTO `UserResponse` → `User` | 导入 + 调用 | `UserResponse.from(user)` 只挑安全字段输出，刻意剔除密码相关字段（`UserResponse.java:12-14`） |
| `PageResult<T>` → `PageResponse<T>` | 类型使用 | 应用层分页载体映射为 REST 响应结构 `{items, page, size, total}`（`PageResponse.java:5`） |
| `User` → 数据库表 `sec_user` | 映射 | `@Entity @Table(name = "sec_user")` + Flyway `V1__iam_schema.sql` 建表，`version BIGINT NOT NULL DEFAULT 0` 与 `@Version` 字段对应 |

## 调用跟踪

```
GET  /api/v1/users?page&size
  → UserController.list (PageResponse 组装)
  → UserDirectoryService.list (@Transactional(readOnly=true))
      → users.findAllUsers(page, size)   // PageRequest 升序 userId
      → users.countUsers()
      → PageResult<User>
GET  /api/v1/users/{userId}
  → UserController.get
  → UserDirectoryService.get
      → requireUserId → users.findByUserId → orElseThrow(NotFoundException "USER_NOT_FOUND")
POST /api/v1/users
  → UserController.create (@Valid CreateUserRequest → toDetails)
  → UserDirectoryService.create
      → User(rawUserId, details, passwordHasher.hash(requirePassword(password)))
      → users.existsByUserId → 重复则 BusinessRuleException "USER_ALREADY_EXISTS"
      → users.saveUser → 201
PUT  /api/v1/users/{userId}
  → UserController.update (@Valid UpdateUserRequest → toDetails)
  → UserDirectoryService.update
      → get → isAdmin() && 目标非管理员 && isLastAdmin() → BusinessRuleException "LAST_ADMIN"
      → user.applyDetails(details)
      → password != null → user.changePassword(passwordHasher.hash(...))
      → users.saveUser
DELETE /api/v1/users/{userId}  (Header X-User-Id = 操作者)
  → UserController.delete
  → UserDirectoryService.delete
      → get → actor.equals(userId) → BusinessRuleException "CANNOT_DELETE_SELF"
      → isAdmin() && isLastAdmin() → BusinessRuleException "LAST_ADMIN"
      → users.deleteUser → 204
错误路径：任意领域异常 / 校验异常 → GlobalExceptionHandler → ApiError{code, message, details}
```

## 需求分类

新特性开发（遗留 COBOL 在线程序迁移 + 安全防护规则新增）：

- 迁移：`COUSR00C`（列表）、`COUSR01C`（新增）、`COUSR02C`（修改）、`COUSR03C`（删除）四个 3270 屏幕程序迁移为 REST CRUD，业务规则编号 BR-USER-01..07。
- 新增：`NR-USER-01`（禁止删除/降级最后一个管理员）与 `NR-USER-02`（禁止删除自己）是遗留系统完全没有的防护规则（遗留 `COUSR03C.cbl` 全文无管理员计数，可导致系统失去管理员）。同时按 ADR-008 修正遗留缺陷：明文密码改 PBKDF2 哈希存储、密码大小写处理统一。

## 示例使用上下文

- **使用场景**：管理员（`userType = 'A'`，登录后 landingMenu=ADMIN）维护系统用户目录。REST 基础路径 `/api/v1/users`，与遗留程序映射见 `docs/design/06-traceability-matrix.md` §1（COUSR00C→GET、COUSR01C→POST、COUSR02C→PUT、COUSR03C→DELETE）。
- **为何重要**：用户目录是登录（`AuthenticationService.login`）的数据源；`User` 实体同时被登录用例读取密码哈希做校验。删除/降级保护直接关系系统管理员是否存在，是安全与可用性的底线。
- **鉴权范围**：按 ADR-007，本期 iam 只签发/校验 token，资源侧不强制鉴权（本地演示环境），因此删除接口通过可选请求头 `X-User-Id` 传递"操作者身份"用于自删除保护——这是保护规则在无网关时代的轻量落点。

## 具体根因分析（如何）

- **为什么新增这些文件**：iam-service 原本只有登录（`AuthenticationService` + `User` 域对象雏形），没有用户目录维护能力；本次补齐 CRUD 全链路。所有文件均为新增（diff 均为 `new file mode 100644`），不存在改动既有文件的情况——说明这是"增量能力"而非"修改行为"。
- **遗留环境约束**：
  - 遗留 `USRSEC` 文件 `SEC-USR-PWD PIC X(8)` 明文、定长 8 位，且新增不转大写而登录转大写（`COUSR01C.cbl:157`），导致含小写密码永远无法登录——ADR-008 决策：PBKDF2-HMAC-SHA256（210000 迭代、16 字节盐、`pbkdf2$iter$salt$hash` 编码），密码 8-64 位，trim 后保存；用户号统一 trim + 大写（BR-SGN-02）。
  - 遗留标识为零填充定长字符串：`user_id VARCHAR(8)`，因此用户号校验为正则 `^[A-Z0-9]{8}$`，主键即业务键。
  - 遗留 `READ ... UPDATE` + 屏幕快照比对被 ADR-006 替换为 `@Version` 乐观锁：`User` 带 `@Version long version`，更新响应回传递增后的 `version`，冲突由 `GlobalExceptionHandler` 统一映射 409 `CONCURRENT_UPDATE`。
  - 并发安全：`isLastAdmin()` 用 `countByUserType(TYPE_ADMIN) <= 1` 判断，在应用服务事务内"先读后判再写"，事务隔离保证判断与写入原子。
- **校验分层**：REST 层（Jakarta Bean Validation，请求 DTO 上注解）负责格式校验（必填、正则、长度），领域层（`User` 的 `require*` 方法）负责业务语义校验（枚举 A/U、trim 规范化），应用层负责跨实体约束（唯一性、管理员保护）。三层各司其职，错误码与文案保持一致（如 `User Type must be A or U.` 在 DTO 与领域层文案一致，测试 `UserControllerTest.java:166` 断言 400 details）。

## 当前与预期行为

- **实现前**：iam-service 只提供登录/验签（`/api/v1/auth/login`、`/verify`），无任何用户维护接口；`User` 域对象仅服务登录。管理员只能通过种子数据（`V2__iam_seed.sql` 的 ADMIN001/USER0001）存在，无法增删改。
- **实现后**：
  - 提供 `/api/v1/users` 四类操作：分页列表（BR-USER-05：按 userId 升序、默认 10、上限 100）、详情（404 USER_NOT_FOUND）、新增（重复 409 USER_ALREADY_EXISTS）、修改（PUT 幂等，password 缺省则保持原哈希）、删除（404 / 409 保护规则）。
  - 密码从不落明文：`User` 只保存 `passwordHash`，`UserResponse` 刻意不含任何密码字段（测试 `UserControllerTest.java:105,135` 断言 `passwordHash` 不存在）。
  - 管理员保护：`delete`/`update` 前检查 `isLastAdmin()`（全库管理员 ≤ 1 时拒绝降级/删除，409 LAST_ADMIN）；`delete` 检查操作者（`X-User-Id` 归一化后）与被删用户是否同一人（409 CANNOT_DELETE_SELF）。
- **行为差异要点**：遗留删除无任何保护（可删掉最后一个管理员），本实现补齐；遗留明文密码，本实现改哈希；遗留修改逐字段比较有变化才写库，本实现按 REST 语义改为幂等 PUT（同值更新不报错，BR-USER-06 部分实现）。乐观锁冲突提示沿用遗留文案 "Record changed by some one else. Please review"。

## 需求实现逻辑（如何/为什么）

### 新增文件清单（均在 `services/iam-service` 下）

1. **`domain/model/User.java`（聚合根，充血模型）**：`@Entity @Table("sec_user")`。持有全部字段（`userId` 8 位主键、`firstName`/`lastName` 20 位、`passwordHash` 200 位、`userType` 1 位、`@Version version`）。关键领域行为：
   - 静态工厂式构造 `User(userId, details, passwordHash)`：归一化用户号并正则校验（`requireUserId`，`User.java:240-246`），委托 `applyDetails` 校验姓名/类型。
   - `normalizeUserId(raw)`（`User.java:203-205`）：trim + `toUpperCase(Locale.ROOT)`，登录与维护共用同一归一化，保证"用户号比较前统一"（BR-SGN-02）。
   - `applyDetails(details)`（`User.java:210-217`）：姓名 trim、非空、≤20 位；类型 trim + 大写后仅允许 A/U（BR-USER-01/04）。
   - `changePassword(hash)`（`User.java:222-227`）：只接受已哈希值，实体本身不接触明文密码。
   - `isAdmin()` / `landingMenu()`（`User.java:229-238`）：`TYPE_ADMIN("A")` 判定与登录菜单分流（BR-SGN-04/05）。
   - 意图：把校验与行为收敛进聚合根，Service 不堆 setter（仓库 Java 约定 §3 充血模型）。
2. **`domain/model/UserDetails.java`（值对象 record）**：`(firstName, lastName, userType)` 三个可维护字段的载体，连接请求 DTO 与聚合根，避免 Service 逐个传参。
3. **`domain/repository/UserRepository.java`（仓储端口）**：`findByUserId`/`existsByUserId`/`saveUser`/`findAllUsers`/`countUsers`/`countByUserType`/`deleteUser` 七个方法。纯接口、不依赖 Spring Data，是 domain ← infrastructure 的接缝（文档注明实现见 `UserJpaRepository`）。
4. **`domain/security/PasswordHasher.java`（端口）**：`hash`/`verify` 两个方法，ADR-008 的算法决策被隔离在端口之后。
5. **`application/UserDirectoryService.java`（用例 + 事务边界）**：类级 `@Service @Transactional`；查询方法 `@Transactional(readOnly = true)`。五个用例：
   - `list(page, size)`（行 42-47）：页/大小防御（负页归 0、size ≤0 取默认 10、>100 截断），返回 `PageResult<User>`。
   - `get(rawUserId)`（行 50-55）：`requireUserId` 非空校验 → `findByUserId().orElseThrow(NotFoundException("USER_NOT_FOUND"))`。
   - `create(rawUserId, details, password)`（行 60-67）：先哈希密码（`passwordHasher.hash(requirePassword(password))`）再构造 `User`，`existsByUserId` 判重（先查后写，避免依赖主键冲突异常），`saveUser`。
   - `update(rawUserId, details, password)`（行 73-86）：读 → 判"降级最后一个管理员"（`isAdmin() && 目标非 A && isLastAdmin()` → 409 LAST_ADMIN）→ `applyDetails` → `password != null` 才 `changePassword(新哈希)`（缺省保持原密码，BR-USER-06）→ `saveUser`。
   - `delete(rawUserId, actingUserId)`（行 91-103）：读 → 操作者归一化后与被删用户相同 → 409 CANNOT_DELETE_SELF → 管理员且唯一 → 409 LAST_ADMIN → `deleteUser`。
   - `isLastAdmin()`（行 105-107）：`users.countByUserType(TYPE_ADMIN) <= 1`。
   - `requirePassword`（行 120-129）：非空/非空白，trim 后 8-64 位（BR-USER-03，注释明确"登录同样 trim，见 ADR-008"）。
6. **`interfaces/rest/UserController.java`（REST 适配）**：`@RestController @RequestMapping("/api/v1/users")`。`@Valid` 触发请求 DTO 校验；`create` 返回 201 + `UserResponse`；`delete` 读取可选请求头 `X-User-Id`（`ACTING_USER_HEADER`，`required = false`）作为操作者身份；`list` 组装 `PageResponse<UserResponse>`。DTO 映射为 `UserResponse.from(user)` 与 `request.toDetails()`，Controller 不做业务逻辑。
7. **DTO 三件**：
   - `CreateUserRequest`（record）：五项全必填；userId `@Pattern("^[A-Za-z0-9]{8}$")`、姓名 `@NotBlank @Size(max=20)`、密码 `@Size(min=8, max=64)`、类型 `@NotNull @Pattern("[AU]")`；`@Schema` 为 OpenAPI 提供描述与示例；`toDetails()` 组装领域值对象。
   - `UpdateUserRequest`（record）：姓名/类型必填 + 密码可选（`@Size` 仅存在时校验，缺省表示不改密码）。
   - `UserResponse`（record）：`(userId, firstName, lastName, userType, version)`，`from(user)` 静态映射，**刻意剔除 `passwordHash`**（数据最小化，测试断言响应无密码字段）。
8. **`infrastructure/persistence/UserJpaRepository.java`（端口实现）**：`extends JpaRepository<User, String>, UserRepository`，默认方法把领域端口翻译为 Spring Data API；`findAllUsers` 用 `PageRequest.of(page, size, Sort.by(ASC, "userId"))` 满足 BR-USER-05 排序；`countByUserType`/`existsByUserId` 为派生查询。
9. **`infrastructure/security/Pbkdf2PasswordHasher.java`（端口实现）**：PBKDF2WithHmacSHA256、210000 迭代、16 字节 `SecureRandom` 盐、`MessageDigest.isEqual` 常量时间比较（防时序侧信道）、`spec.clearPassword()` 清理内存中的口令副本。
10. **测试**（`03-tests.patch`）：
    - `application/UserDirectoryServiceTest.java`：`@SpringBootTest @ActiveProfiles("test") @Transactional`，直接注入用例服务 + 哈希器做集成级行为验证，覆盖列表排序/404/创建（含用户号 trim+大写、哈希前缀 `pbkdf2$210000$`、verify 回验）/重复拒绝/类型枚举/空白姓名（断言 details 列表）/密码长度/删除与降级最后一个管理员/自删除/密码保持与替换/存在第二个管理员后可删除。
    - `interfaces/rest/UserControllerTest.java`（既有文件，扩展了用户目录用例）：MockMvc 端到端验证 HTTP 语义与错误码（201/204/400/404/409）及响应不含密码字段。

### 非代码文件

- `V1__iam_schema.sql`（既有）：`sec_user` 表与实体列严格对应（`ddl-auto: validate` 约束，新增字段必须同步迁移脚本）。
- `V2__iam_seed.sql`（既有）：种子用户 ADMIN001（A）/USER0001（U），密码为 PBKDF2 哈希（不得明文入库），为测试与演示提供基线数据；测试断言基于这两个种子（total=2）。

### 调用关系变更

- 无既有方法被修改；全部为新增调用链：`UserController → UserDirectoryService → UserRepository → UserJpaRepository`，`PasswordHasher → Pbkdf2PasswordHasher`，`UserDetails` 贯通 DTO-领域。`AuthenticationService` 继续独立使用 `User`/`PasswordHasher`，与用户维护共享同一归一化与哈希语义。

## 具体实现步骤

1. **定义领域模型与值对象**（`User.java` + `UserDetails.java`）：声明 `@Entity` 聚合根，字段与 `sec_user` 表一一对应；构造与 `applyDetails` 内实现字段级校验（用户号正则 `^[A-Z0-9]{8}$`、姓名 1-20、类型 A/U）；`normalizeUserId` 提供全局统一的 trim+大写归一化。
2. **定义密码哈希端口并实现**（`PasswordHasher.java` + `Pbkdf2PasswordHasher.java`）：接口隔离算法；实现用 JDK `SecretKeyFactory("PBKDF2WithHmacSHA256")`，编码格式自包含迭代次数/盐/哈希，`verify` 解析编码串并常量时间比较；密钥规格用后 `clearPassword()`。
3. **定义仓储端口与 JPA 适配**（`UserRepository.java` + `UserJpaRepository.java`）：端口只声明领域需要的读写/计数/分页方法；适配层用默认方法桥接 Spring Data，分页按 userId 升序。
4. **实现用例服务**（`UserDirectoryService.java`）：类级 `@Transactional` 界定边界；查询 `readOnly = true`；每个变更方法按"读聚合 → 校验业务规则 → 领域方法变更 → 保存"编排；密码缺省不改、密码必填走 `requirePassword`（trim + 8-64）。
5. **实现删除/降级保护规则**（同上 update/delete）：先归一化操作者身份，自删除 → `CANNOT_DELETE_SELF`；`isLastAdmin()`（管理员计数 ≤ 1）→ `LAST_ADMIN`；保护判定在保存前于同一事务内完成。
6. **实现 REST 适配层**（`UserController.java` + 三个 DTO）：请求 DTO record + Jakarta 校验注解 + `@Schema` 文档；`toDetails()` 转领域值对象；`UserResponse.from` 映射且剔除密码字段；删除接口读取可选 `X-User-Id` 头。
7. **确认错误映射**（`GlobalExceptionHandler` 既有）：校验失败 400（含 Bean Validation 的字段级 details）、未找到 404、业务规则 409、乐观锁冲突 409；`ApiError` 统一 `{code, message, details}` 结构（仓库 Java 约定 §4）。
8. **补齐数据库脚本**（既有 `V1`/`V2`）：建表列与实体一致（含 `version`）；种子数据写入 PBKDF2 哈希，幂等 INSERT 供 H2/PostgreSQL 双跑。
9. **编写测试**：应用层 `@SpringBootTest` 用例（覆盖每条 BR/NR 规则的通过与拒绝路径、密码哈希回验、分页断言）；REST 层 MockMvc 用例（HTTP 语义、错误码、响应字段最小化断言）。

## 需求实施检查清单

- **用户号**：入库前必须 trim + 大写（`Locale.ROOT`，避免土耳其 i 问题）；长度/字符集在领域层与 DTO 双层校验；主键即业务键，判重用 `existsByUserId` 而非捕获主键异常。
- **密码**：绝不落明文；`requirePassword` 先判空再 trim 后查长度（避免空白通过长度检查）；哈希用 PBKDF2（自包含编码格式，`verify` 从编码串读迭代次数）；用户号大写转换不要作用于密码（ADR-008）。
- **管理员保护**：`isLastAdmin()` 基于 `countByUserType(A) <= 1`，必须在"改/删"同一事务内判定；先判自删除再判 LAST_ADMIN（测试 `refusesSelfDeletionWith409` 用 ADMIN001 自删命中 CANNOT_DELETE_SELF 而非 LAST_ADMIN，顺序敏感）；降级保护条件是"当前是管理员 && 目标类型非 A"。
- **更新语义**：PUT 幂等（同值更新不报错）；password 为 null 表示保持原哈希，不要用空串占位（`update` 只认 `password != null`）。
- **响应最小化**：任何用户响应不得含 `password`/`passwordHash` 字段（测试断言 `doesNotExist`）；version 回传供乐观锁冲突重试。
- **分页防御**：page < 0 归 0、size ≤ 0 取默认、> 上限截断，默认 10 上限 100（与遗留每页 10 行对应）。
- **校验文案一致**：DTO 注解与领域层异常文案保持一致（如 "User Type must be A or U."），错误码大写蛇形（`USER_NOT_FOUND`/`USER_ALREADY_EXISTS`/`LAST_ADMIN`/`CANNOT_DELETE_SELF`），`details` 为 `字段: 消息` 列表。
- **分层纪律**：校验分三层（REST 格式、领域语义、应用跨实体）；Controller 不做业务逻辑，Service 不堆 setter，事务边界在应用层；domain 不 import Spring 框架类（`User.java` 只 import jakarta.persistence，其余为 JDK）。
- **种子与测试数据**：测试断言依赖种子用户（ADMIN001/USER0001），用例内尽量自含（如先 update 出一个新管理员再删旧管理员），避免用例间互相依赖。

## 总结

本需求是 iam-service（身份与访问上下文）的用户目录维护能力新增：把遗留 COBOL 在线程序 COUSR00C/01C/02C/03C 的四个屏幕用例迁移为 REST CRUD（`GET/POST/PUT/DELETE /api/v1/users`），并在迁移中按 ADR-008（PBKDF2 密码哈希）、ADR-006（@Version 乐观锁）落地安全与并发基线，同时新增两条遗留系统缺失的防护规则——NR-USER-01（禁止删除/降级最后一个管理员，409 LAST_ADMIN）与 NR-USER-02（禁止自删除，409 CANNOT_DELETE_SELF，经可选请求头 X-User-Id 判定）。实现遵循仓库四层依赖纪律：`interfaces/rest`（UserController + 请求/响应 DTO，校验与文档注解）→ `application`（UserDirectoryService，事务边界与用例编排）→ `domain`（User 充血聚合根、UserDetails 值对象、UserRepository/PasswordHasher 端口、领域异常）← `infrastructure`（UserJpaRepository、Pbkdf2PasswordHasher 实现端口）；错误统一由 GlobalExceptionHandler 映射为 `{code, message, details}`。行为变化：此前仅登录可用、用户目录只读种子，此后具备完整可维护的用户目录，且密码永不明文、管理员底线受保护。实现模式可迁移：领域校验收敛聚合根、端口-适配隔离框架、用例级事务与"读-判-改-存"编排、DTO 响应最小化、保护规则置于应用层并配齐正反路径测试。
