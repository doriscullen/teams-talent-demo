# 单元测试与检查结果：消费返现权益说明页

| 项 | 内容 |
|---|---|
| 需求 | `REQ-ba1e28a4-3755-4b4f-9b24-82b872d1187c` |
| codeVersion | `carddemo-java-1025@a360bd30b0b9` |
| 采集时间 | 2026-10-27 22:12 (CST) |
| 执行环境 | macOS arm64，Node v24.14.1；**无 JDK、无 Maven、无 `~/.m2`** |

## 1. 已执行（真实运行）

```bash
node --test services/web-ui/src/test/js/cashback-benefit.test.mjs
```

结果：**14 passed / 0 failed**（exit 0，耗时约 48ms）

| # | 用例 | 覆盖 |
|---|---|---|
| 1 | 白金卡判定为有资格，入口可见 | REQ-001 |
| 2 | 非白金等级判定为无资格，入口不可见 | REQ-002 |
| 3 | cardTier 缺失的各种形态均为资格未知，入口不可见 | REQ-002、设计 §6（失败关闭） |
| 4 | 等级值首尾空白不影响判定，大小写不做猜测 | 判定口径 |
| 5 | 不得由卡号、卡面名或 activeStatus 推断资格 | 展示规则（资格来源） |
| 6 | 已确认规则只有三项且口径与 PRD 一致 | REQ-003/004/005 |
| 7 | 待确认事项为六项且顺序与需求原文一致 | REQ-007 |
| 8 | 已确认内容不出现具体日期、金额上限、到账承诺或总返现比例 | REQ-008、BR-003/004/007 |
| 9 | 对外提示指向最终公布规则 | REQ-009 |
| 10 | 应用入口先加载权益脚本再加载主程序 | 运行顺序 |
| 11 | 入口与说明页共用同一资格判定，不在页面里硬编码等级值 | 单一口径 |
| 12 | 卡详情页渲染入口、说明页区分三种资格状态 | REQ-001/010 |
| 13 | 后端契约与迁移脚本使用同一字段 card_tier / cardTier | 契约一致性 |
| 14 | 本次未改动返现计算与入账链路 | REQ-011、BR-006 |

附加执行：`node --check` 对 `app.js` 与 `cashback-benefit.js` 语法检查通过。

## 2. 已编写但**未执行**

`services/card-service/src/test/java/com/carddemo/card/interfaces/rest/CardControllerTest.java` 新增 4 个 JUnit 用例：

| 用例 | 断言 |
|---|---|
| `getReturnsPlatinumTierForCardWithRegisteredTier` | 卡 `0500024453765740` 返回 `cardTier=PLATINUM` |
| `getReturnsNullTierWhenCardTierIsNotRegistered` | 卡 `1122334455667788` 返回 `cardTier=null` |
| `listByAccountExposesCardTierForBenefitEntry` | 按账户列表聚合返回 `cardTier` |
| `maintenanceUpdateDoesNotWriteCardTier` | 卡片维护更新不写 `cardTier` |

未执行原因：本机 `java` 为系统占位（`Unable to locate a Java Runtime`），`mvn` 不在 PATH，且无本地 Maven 仓库，`mvn test` 无法启动。**以上用例不代表已通过**，需在有 JDK 21 + Maven 的环境复跑：

```bash
mvn -pl services/card-service test
```

## 3. 剩余限制

1. `mvn test`（含既有 197 个用例）未执行，回归结论待补。
2. 页面未做浏览器实机走查（无运行中的服务栈），DOM 层行为仅由源码静态检查覆盖。
3. 说明页文案为 PRD 拟定口径，未经业务/合规确认（PRD TBD-009）。
4. `cardTier` 取值与真实等级来源待业务确认（PRD TBD-007），当前为演示种子。
