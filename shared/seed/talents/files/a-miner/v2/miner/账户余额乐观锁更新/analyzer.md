# 账户余额乐观锁更新 代码分析报告

## 仓库知识层次分类

本需求位于 CardDemo 信用卡核心系统（DDD 微服务，Maven 多模块）的**账户上下文**中，影响层次如下：

> account-service（账户上下文） → application 层（用例编排与事务边界） → domain 层（聚合根与领域行为） → infrastructure 层（JPA 仓储适配器） → 数据库（Flyway 迁移脚本） → interfaces 层（统一错误响应）

具体落点：

- **application 层**：`AccountApplicationService`（`services/account-service/src/main/java/com/carddemo/account/application/AccountApplicationService.java`）——`@Service @Transactional` 用例服务，定义事务边界，编排"读聚合根 → 领域方法变更 → 保存"。
- **domain 层**：`Account`（`.../domain/model/Account.java`）——聚合根实体，`@Version` 乐观锁版本字段，及 `applyPosting`/`applyBillPayment`/`accrueInterest`/`applyCashback`/`applyDetails` 等余额变更领域方法；`AccountRepository`（`.../domain/repository/AccountRepository.java`）——仓储端口接口。
- **infrastructure 层**：`AccountJpaRepository`（`.../infrastructure/persistence/AccountJpaRepository.java`）——Spring Data 适配器，实现领域仓储端口；`db/migration/V1__account_schema.sql`——建表脚本，`version BIGINT NOT NULL DEFAULT 0`。
- **interfaces 层**：`GlobalExceptionHandler`（`.../interfaces/rest/GlobalExceptionHandler.java`）——`@RestControllerAdvice`，将 `OptimisticLockingFailureException` 统一映射为 HTTP 409 + `CONCURRENT_UPDATE`；`ApiError`（`.../interfaces/rest/ApiError.java`）——统一错误响应结构；`AccountResponse`（`.../interfaces/rest/dto/AccountResponse.java`）——响应 DTO，回传 `version` 供客户端冲突后重试。
- **测试**：`AccountTest`（`.../src/test/java/com/carddemo/account/domain/model/AccountTest.java`）——纯 JUnit 领域行为单测。

## 需求影响位置依赖分析

依赖方向遵循仓库规范 `interfaces → application → domain ← infrastructure`（依赖倒置，domain 不依赖框架）。

| 依赖 | 类型 | 原因与方式 |
|---|---|---|
| `AccountApplicationService` → `AccountRepository` | 端口调用 | 应用服务构造器注入 `AccountRepository accounts`（`AccountApplicationService.java:30-36`），事务内调用 `findByAccountId` / `saveAccount` 完成读-改-写 |
| `AccountApplicationService` → `Account` | 领域方法调用 | `getById` 返回 `Account` 后调用 `account.applyPosting(amount)` 等方法（`AccountApplicationService.java:56-72`），领域变更在事务内发生 |
| `AccountApplicationService` → `NotFoundException` | 异常依赖 | `getById` 中 `orElseThrow(() -> new NotFoundException("ACCOUNT_NOT_FOUND", ...))`（`AccountApplicationService.java:40-42`） |
| `Account` → `BusinessRuleException` | 异常依赖 | 领域方法校验失败抛 `BusinessRuleException("CODE", "message")`（如 `applyBillPayment` 的 `NOTHING_TO_PAY`，`Account.java:189`） |
| `Account` → JPA 注解 | 框架依赖 | `@Entity @Table(name = "account") @Version @Column(name = "version")`（`Account.java:111-156`）；`@Version` 是乐观锁的核心触发点 |
| `AccountJpaRepository` → `AccountRepository` | 接口实现/继承 | `interface AccountJpaRepository extends JpaRepository<Account, String>, AccountRepository`，用 `default` 方法桥接领域端口方法到 Spring Data 方法（`findByAccountId→findById`、`saveAccount→save`、`findAllAccounts→findAll`）（`AccountJpaRepository.java:346-362`） |
| `GlobalExceptionHandler` → `OptimisticLockingFailureException` | 异常处理 | Spring Data JPA 在 flush 时因版本冲突抛出的异常，由 `@ExceptionHandler` 捕获（`GlobalExceptionHandler.java:60-65`） |
| `GlobalExceptionHandler` → `ApiError` | 响应组装 | `ApiError.of("CONCURRENT_UPDATE", "Record changed by some one else. Please review")` 组装统一错误体 |
| `AccountResponse` → `Account` | 静态工厂调用 | `AccountResponse.from(account)` 拷贝全部字段并回传 `account.getVersion()`（`AccountResponse.java:95-110`），使客户端持有最新版本号 |
| `Account` ↔ `V1__account_schema.sql` | 表-实体映射 | 实体字段 `version` 对应 DDL `version BIGINT NOT NULL DEFAULT 0`（`V1__account_schema.sql:382`）；实体默认值由构造函数 `this.version = 0` 补齐，保证新对象与库中行一致 |
| `AccountController` → `AccountApplicationService` | 调用 | REST 端点（PUT/POST 记账、支付、利息、返现）转调应用服务（`AccountController.java:47-79`） |

## 调用跟踪

以"余额记账（POST /api/v1/accounts/{id}/postings）"为例的完整调用流：

```
AccountController.post(accountId, PostingRequest)
  └─ AccountApplicationService.applyPosting(accountId, amount)      [@Transactional 事务开始]
       ├─ AccountApplicationService.getById(accountId)
       │    └─ AccountRepository.findByAccountId → AccountJpaRepository.findById
       │         └─ 未找到 → NotFoundException → GlobalExceptionHandler.handleNotFound → 404
       ├─ Account.applyPosting(amount)                               [领域方法变更 currentBalance/currentCycleCredit]
       └─ AccountRepository.saveAccount(account) → JpaRepository.save
            └─ 事务提交时 flush：UPDATE account SET ... WHERE account_id=? AND version=?
                 ├─ 影响行数=1 → 提交成功，version 递增，AccountResponse 回传新 version
                 └─ 影响行数=0 → OptimisticLockingFailureException
                      └─ GlobalExceptionHandler.handleOptimisticLock → 409 {"code":"CONCURRENT_UPDATE",...}
```

更新类操作（`update`/`applyPosting`/`applyBillPayment`/`accrueInterest`/`creditCashback`）全部遵循同一"读-改-写"调用模式；`creditCashback` 额外先查 `RewardCreditRepository.existsByRewardId` 实现幂等（`AccountApplicationService.java:77-87`）。

## 需求分类

这是一个**并发安全改造/新特性开发**需求：在账户余额更新场景落地乐观锁机制。本质是把遗留主机（CICS）的"记录锁 + 人工快照比对"并发控制模型，迁移为 Web/微服务架构下基于版本号的乐观并发检测（ADR-006，已接受），并配套统一错误响应。底层涉及数据库版本字段、事务边界与全局异常处理三个横切点。

## 示例使用上下文

- **何时使用**：任何修改 `account` 聚合根的 REST 请求（账户维护 PUT、记账/支付/利息/返现 POST）。这些接口都可能被多个客户端并发触发——例如同一账户同时被批量记账作业、还款请求、营销返现任务操作。
- **为什么重要**：余额、额度等金额字段不可自动合并（A 操作加 50、B 操作改限额若并发回写会互相覆盖）。乐观锁确保"最后一次写入者基于过期快照更新"时被拒绝并提示重试，而不是静默覆盖。
- **使用示例**：
  ```json
  // 请求：POST /api/v1/accounts/00000000003/postings  {"amount": 10.00}
  // 成功响应 200：{..., "currentBalance": 1950.00, "version": 1}
  // 冲突响应 409：{"code":"CONCURRENT_UPDATE","message":"Record changed by some one else. Please review","details":[]}
  ```
- **遗留背景**：遗留程序 `COACTUPC.cbl:4109-4191` 用 `READ ... UPDATE` 加记录锁，保存时逐字段比对屏幕快照，不一致提示 `Record changed by some one else. Please review`（该文案在本次实现中原样保留）。Web/微服务不能持有数据库锁跨越用户思考时间，故 ADR-006 决策改乐观锁。

## 具体根因分析（如何）

- **为何必须改并发模型**：遗留记录锁依赖 CICS 长事务，锁跨用户思考时间；微服务架构下无长事务概念，且数据库锁会显著降低吞吐、易死锁。ADR-006 权衡了三个方案（JPA @Version 乐观锁 / SELECT FOR UPDATE 悲观锁 / 字段级合并+审计），最终选 A：实现成本低、无锁等待、版本号可追溯审计、与数据库无关（PostgreSQL 与 H2 行为一致便于测试）。
- **为何修改这些文件**：
  - `Account.java` 加 `@Version`：Hibernate 据此生成 `WHERE version=?` 的 UPDATE，冲突时抛 `OptimisticLockingFailureException`——这是乐观锁机制的唯一触发源，必须放在聚合根实体上。
  - `V1__account_schema.sql` 加 `version BIGINT NOT NULL DEFAULT 0`：DDL 与实体必须一致（`ddl-auto: validate`，见 `application.yml:17`，不一致会导致启动失败）。
  - `GlobalExceptionHandler` 新增处理器：`OptimisticLockingFailureException` 若不处理会变成 500，必须统一映射为 409 让调用方理解"需要重试"语义。
  - `AccountResponse` 回传 `version`：客户端需要最新版本号才能携带重试（或前端提示刷新）。
- **环境约束**：Spring Boot 3.3.6 + JPA（Hibernate）、Flyway 迁移、PostgreSQL/H2 双跑（`application.yml` `ddl-auto: validate` 强制表结构与实体一致）；JDK 21，`BigDecimal`/`LocalDate` 金额日期规范；测试用 H2 内存库 + Flyway 迁移 + 种子数据（`application-test.yml`、V2 种子）。

## 当前与预期行为

- **实现前**：并发更新时，两个事务基于同一旧快照先后提交，后者静默覆盖前者（丢失更新 lost update）；错误响应缺失，框架异常直接暴露为 500。
- **实现后**：
  - 每个账户聚合根带版本号，保存时 `UPDATE ... WHERE version=?`，版本不匹配则抛 `OptimisticLockingFailureException`，事务回滚。
  - 全局异常处理器统一转译为 409 `CONCURRENT_UPDATE`，文案沿用遗留提示语。
  - 响应回传 `version`，支持"冲突 → 重新读取 → 重试"闭环。
- **独特方面（易被忽略）**：
  1. 版本冲突在 **flush/提交时**才抛出，而非 `save()` 调用时——所以应用服务方法返回时一切正常，异常在事务边界显现，由全局处理器兜底，业务代码无需 try-catch。
  2. `@Version` 的实体在 `save()` 时 Hibernate 自动判断 new/merge 语义；本例每次操作都在同一事务内先 `findById`（取得托管实体）再变更，`save` 走 merge 分支，`WHERE version=?` 生效。
  3. 新对象 `version` 必须与 DDL `DEFAULT 0` 对齐：构造函数 `this.version = 0`（`Account.java:165`），否则 Hibernate 插入的行版本与数据库默认值错位。
  4. 幂等写入（`creditCashback`）与乐观锁配合：先查 `reward_credit` 去重，再改余额；即使两个返现请求并发，奖励表主键唯一 + 账户行版本号可防止重复冲减。
  5. 仓库规范要求"每个聚合表带 version"（`07-java-conventions.md` §6）——同一模式在全仓 7 个服务（iam/customer/card/account/transaction/authorization/marketing）的实体与 `GlobalExceptionHandler` 中重复出现，说明这是仓库级基线而非单服务特例。

## 需求实现逻辑（如何/为什么）

**实现位置与职责**：

- `Account.java`（新增，`domain/model`）：聚合根。`@Version private long version`（行 154-156）触发乐观锁；余额变更领域方法 `applyPosting`/`applyBillPayment`/`accrueInterest`/`applyCashback` 集中表达业务规则（BR-POST-006、BR-BILL-001/002、BR-INT-001、NR-REWARD-01），失败抛 `BusinessRuleException`。充血模型：变更逻辑在实体上而非 Service 里堆 setter（仓库规范 §3）。
- `AccountApplicationService.java`（新增，`application`）：`@Service @Transactional`，事务边界在此；`update`/`applyPosting` 等方法统一"`getById` → 领域方法 → `saveAccount`"三步，`@Transactional(readOnly = true)` 用于查询。
- `AccountJpaRepository.java`（新增，`infrastructure/persistence`）：Spring Data 接口 + 领域端口实现，`default` 方法桥接，避免仓储适配器侵入 domain。
- `V1__account_schema.sql`（新增，`resources/db/migration`）：建表，`version BIGINT NOT NULL DEFAULT 0`；`group_id` 索引供按组查询。
- `GlobalExceptionHandler.java`（新增，`interfaces/rest`）：`@RestControllerAdvice`，四个处理器——404（NotFoundException）、409（BusinessRuleException）、400（MethodArgumentNotValidException 字段校验明细）、409（OptimisticLockingFailureException → CONCURRENT_UPDATE）。
- `ApiError.java`（新增）：`record ApiError(String code, String message, List<String> details)` + `of` 工厂；统一错误体结构（`07-java-conventions.md` §4 定义了 JSON 形状）。
- `AccountResponse.java`（新增）：`record` 响应 DTO，`from(Account)` 工厂，含 `version` 字段回传。
- `AccountTest.java`（新增，`src/test`）：纯 JUnit + AssertJ 领域单测，覆盖余额变更方向、业务规则拒绝路径与错误码。

**非代码文件**：无（应用 `application.yml` 的 `ddl-auto: validate` 与 Flyway 已支持该模式，未新增配置）。

**调用关系**：新增 REST 端点 → 应用服务 → 领域方法 → 仓储端口 → JPA 适配器 → 数据库；异常统一出口为 `GlobalExceptionHandler`。

## 具体实现步骤

1. **实体加乐观锁版本字段**：在聚合根 `Account` 增加 `@Version @Column(name = "version", nullable = false) private long version`，构造时初始化 `version = 0`。`@Version` 是 Hibernate 乐观锁的触发器，之后的 `save` 会自动生成带版本条件的 UPDATE。对应代码：`Account.java:154-156, 165`。
2. **DDL 同步版本字段**：`V1__account_schema.sql` 中 `version BIGINT NOT NULL DEFAULT 0`。因 `ddl-auto: validate`，实体与表结构不一致会启动失败；`DEFAULT 0` 与实体初始值对齐，保证新行版本一致。对应代码：`V1__account_schema.sql:382`。
3. **领域方法表达余额变更（充血模型）**：`applyPosting`（`amount.signum()` 分流本期贷/借累计）、`applyBillPayment`（三重校验：金额>0、有欠款、不超额）、`accrueInterest`（入账并清零周期累计）、`applyCashback`（冲减余额，可为负）。业务规则失败抛 `BusinessRuleException("CODE", ...)`。对应代码：`Account.java:171-218`。
4. **应用服务定义事务边界与读-改-写编排**：类级 `@Transactional`，查询方法覆盖 `@Transactional(readOnly = true)`；变更方法三步"`getById` → 领域方法 → `saveAccount`"。所有余额变更在单事务内完成，保证原子性。对应代码：`AccountApplicationService.java:26-27, 38-48, 50-72`。
5. **仓储端口与适配器桥接**：`AccountRepository`（domain 端口，`findByAccountId`/`saveAccount`/`findAllAccounts`）+ `AccountJpaRepository extends JpaRepository<Account, String>, AccountRepository` 用 `default` 方法映射，保持依赖倒置（domain 不依赖 Spring Data）。对应代码：`AccountRepository.java:11-18`、`AccountJpaRepository.java:346-362`。
6. **统一异常响应**：`ApiError` record 定义错误体（code/message/details）；`GlobalExceptionHandler` 用 `@RestControllerAdvice` 分别处理 NotFound→404、BusinessRule→409、校验→400、`OptimisticLockingFailureException`→409 + `CONCURRENT_UPDATE`（文案沿用遗留提示）。对应代码：`ApiError.java:11-16`、`GlobalExceptionHandler.java:37-65`。
7. **响应回传版本号**：`AccountResponse` 含 `version` 字段，`from(Account)` 拷贝 `account.getVersion()`，让调用方获得最新版本以支持重试闭环。对应代码：`AccountResponse.java:80-110`。
8. **领域行为单测**：纯 JUnit + AssertJ 覆盖余额变更数值方向与各业务规则拒绝路径（断言异常 `code` 而非消息文本）。对应代码：`AccountTest.java:27-101`。

## 需求实施检查清单

- [ ] 聚合根是否加了 `@Version`？`version` 字段是否与 DDL 的 `BIGINT NOT NULL DEFAULT 0` 一致（`ddl-auto: validate` 下不一致直接启动失败）？
- [ ] 新实体构造时是否初始化 `version = 0`，与 `DEFAULT 0` 对齐？
- [ ] 变更方法是否在**同一事务**内完成"读-改-写"？事务边界是否落在应用服务（`@Transactional`），而不是 Controller 或 Repository？
- [ ] 是否记得冲突异常在 **flush/提交时**抛出（而非 save 调用时）？业务代码无需 try-catch，但全局处理器必须兜底 `OptimisticLockingFailureException`。
- [ ] 全局异常处理器是否把乐观锁冲突映射为 **409**（而不是任其变成 500）？错误码是否使用统一的 `CONCURRENT_UPDATE` 或仓库既定的错误码？
- [ ] 响应 DTO 是否回传 `version`？前端/调用方是否需要携带版本号重试？
- [ ] 查询方法是否标注 `@Transactional(readOnly = true)`？
- [ ] 金额是否用 `BigDecimal` 且 `signum()`/`compareTo()` 比较（禁止 `double`、禁止 `==`）？
- [ ] 遗留业务规则是否以 `BusinessRuleException("CODE", ...)` 表达、错误码是否可追溯（BR-/R-/NR- 编号）？
- [ ] 是否补充了领域行为单测（断言错误码而非日志/实现细节）？
- [ ] 是否有幂等需求（如返现入账）？幂等表 + 唯一键 + 事务内先查后写是否与乐观锁配合验证过？
- [ ] 是否检查过同一仓库其他服务中该模式的一致性（如本仓 iam/customer/card/transaction/authorization/marketing 均有相同 `@Version` + 409 处理）？

## 总结

本需求为 account-service 落地"账户余额乐观锁更新"：将遗留 CICS 的"记录锁 + 快照比对"并发控制（`COACTUPC.cbl`）迁移为 JPA `@Version` 乐观锁（ADR-006 决策）。实现横跨 DDD 全层：聚合根 `Account` 增加 `@Version` 版本字段并集中表达记账/还款/利息/返现等领域行为；`AccountApplicationService` 以 `@Transactional` 定义事务边界、编排"读-改-写"；`AccountJpaRepository` 通过 `default` 方法桥接领域仓储端口；Flyway `V1` 建表同步 `version BIGINT NOT NULL DEFAULT 0`；`GlobalExceptionHandler` 将并发冲突统一映射为 409 `CONCURRENT_UPDATE`（沿用遗留提示文案）；`AccountResponse` 回传版本号支撑冲突重试闭环；`AccountTest` 覆盖领域行为与规则拒绝路径。该模式与仓库 `07-java-conventions.md` §6 的基线一致，并在全部 7 个微服务中重复出现，属于仓库级通用开发范式。
