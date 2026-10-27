# API 目录（服务间契约）

> 所有服务遵循 `docs/design/07-java-conventions.md`。基础路径 `/api/v1`，JSON，UTF-8。
> 面向业务人员的界面：`http://localhost:8090/`（web-ui 托管 SPA 并同源代理全部 `/api/**`）。
> 每个服务提供 Swagger UI（根路径自动跳转）：`http://localhost:8081/` … `http://localhost:8087/`，
> 登录请求体已预填 `ADMIN001/admin123`；OpenAPI 描述位于 `/v3/api-docs`。
> 列表响应统一 `{"items": [...], "page": 0, "size": 10, "total": 42}`。
> 错误响应统一 `{"code": "...", "message": "...", "details": [...]}`，HTTP 语义见规范 §4。

## 0. 种子数据契约（6 个服务必须一致）

### 客户（customer-service）

| customerId | 姓 / 名 | 城市(addressLine3) | 州 | 邮编 | FICO | 主卡 |
|---|---|---|---|---|---|---|
| 000000001 | Kessler / Immanuel | Altenwerthshire | NY | 10001 | 720 | Y |
| 000000002 | Rosenbaum / Enrico | West Bernita | CA | 90002 | 680 | N |
| 000000003 | Homenick / Larry | New Gladys | TX | 75003 | 750 | N |
| 000000004 | DuBuque / Claire | Springfield | IL | 62704 | 800 | Y |
| 000000005 | Chen / Marcus | Seattle | WA | 98101 | 640 | N |
| 000000006 | Marino / Sofia | Miami | FL | 33101 | 710 | Y |
| 000000007 | Whitfield / Daniel | Denver | CO | 80202 | 590 | N |
| 000000008 | Bennett / Aisha | Chicago | IL | 60601 | 765 | N |

### 卡片（card-service）

| cardNumber | accountId | customerId | 到期日 | 状态 | 卡面名 |
|---|---|---|---|---|---|
| 0500024453765740 | 00000000001 | 000000001 | 2028-05-20 | Y | IMMANUEL KESSLER |
| 6677889900112233 | 00000000001 | 000000001 | 2029-01-01 | Y | IMANUEL KESSLER |
| 0683586198171516 | 00000000002 | 000000002 | 2029-08-11 | Y | ENRICO ROSENBAUM |
| 0923877193247330 | 00000000003 | 000000003 | 2027-01-10 | Y | LARRY HOMENICK |
| 1122334455667788 | 00000000004 | 000000004 | 2028-02-14 | Y | CLAIRE DUBUQUE |
| 2233445566778899 | 00000000005 | 000000005 | 2029-07-01 | Y | MARCUS CHEN |
| 3344556677889900 | 00000000006 | 000000006 | 2028-03-09 | Y | SOFIA MARINO |
| 4455667788990011 | 00000000007 | 000000007 | 2024-05-05 | N | DANIEL WHITFIELD |
| 5566778899001122 | 00000000008 | 000000008 | 2030-09-30 | Y | AISHA BENNETT |

### 用户（iam-service）

| userId | 密码（明文，仅种子） | 类型 | 名 / 姓 |
|---|---|---|---|
| ADMIN001 | admin123 | A | System / Administrator |
| USER0001 | user1234 | U | Demo / User |

密码以 PBKDF2 哈希存入 Flyway 种子脚本（不得明文入库）。

### 交易参照数据（transaction-service）

| 类型码 | 描述 | 类别码（类型内） | 类别描述 | 利率（组 A000000000 / DEFAULT） |
|---|---|---|---|---|
| 01 | Purchase | 0001 | Regular Sales Draft | 18.00 / 20.00 |
| 01 | Purchase | 0002 | Regular Cash Advance | 24.00 / 20.00 |
| 01 | Purchase | 0003 | Convenience Check Debit | 24.00 / 20.00 |
| 01 | Purchase | 0004 | ATM Cash Advance | 24.00 / 20.00 |
| 01 | Purchase | 0005 | Interest Amount | 0.00 / 0.00 |
| 02 | Payment | 0002 | Payment | 0.00 / 0.00 |
| 03 | Credit | 0001 | Credit Adjustment | 0.00 / 0.00 |
| 04 | Authorization | 0001 | Authorization | 0.00 / 0.00 |
| 05 | Refund | 0001 | Refund | 0.00 / 0.00 |
| 06 | Reversal | 0001 | Reversal | 0.00 / 0.00 |
| 07 | Adjustment | 0001 | Adjustment | 0.00 / 0.00 |

类别累计（`tran_category_balance`）种子：账户 1/01/0001 = 1200.00；账户 1/01/0002 = 500.00；
账户 2/01/0001 = 800.00；账户 3/01/0001 = 400.00；账户 4/01/0001 = 300.50；
账户 6/01/0001 = 1500.00；账户 8/01/0001 = 2000.00。

交易种子（`transaction`，按交易号升序）：

| 交易号 | 账户 | 卡号 | 类型/类别 | 金额 | 描述 | 处理时间 |
|---|---|---|---|---|---|---|
| 0000000000000001 | 00000000001 | 0500024453765740 | 01/0001 | 50.47 | Purchase at Abshire-Lowe | 2026-09-15T10:00:00 |
| 0000000000000002 | 00000000002 | 0683586198171516 | 01/0001 | 91.90 | Return item at Nitzsche | 2026-09-16T11:30:00 |
| 0000000000000003 | 00000000003 | 0923877193247330 | 02/0002 | 1470.00 | BILL PAYMENT - ONLINE | 2026-09-20T09:00:00 |
| 0000000000000004 | 00000000001 | 0500024453765740 | 01/0002 | 200.00 | ATM Cash Advance | 2026-09-21T14:15:00 |
| 0000000000000005 | 00000000006 | 3344556677889900 | 01/0001 | 300.75 | Purchase at Ernser-Roob | 2026-09-22T16:45:00 |
| 0000000000000006 | 00000000008 | 5566778899001122 | 01/0001 | 500.00 | Purchase at Gleason | 2026-09-25T08:20:00 |

---

## 1. iam-service（:8081）

### POST /api/v1/auth/login

```json
{"userId": "ADMIN001", "password": "admin123"}
```

`200`：

```json
{
  "token": "<base64url(payload)>.<base64url(hmac)>",
  "expiresAt": "2026-10-26T00:29:46",
  "user": {"userId": "ADMIN001", "firstName": "System", "lastName": "Administrator",
           "userType": "A", "landingMenu": "ADMIN"}
}
```

- 用户号/密码统一 `trim` + 用户号大写；密码不做大小写转换（ADR-008）。
- 失败统一 `401 INVALID_CREDENTIALS`（不区分用户不存在/密码错误）。
- 缺参 `400 VALIDATION_FAILED`。

### POST /api/v1/auth/verify

```json
{"token": "..."}
```

`200`：`{"valid": true, "userId": "ADMIN001", "userType": "A", "expiresAt": "..."}`
`200`（无效/过期）：`{"valid": false}` — 不返回 401（供网关判定）。

### GET /api/v1/users?page=0&size=10

`200`：`{"items": [UserResponse...], "page": 0, "size": 10, "total": 2}`

`UserResponse`：`{"userId","firstName","lastName","userType","version"}`（**不含密码/哈希**）。

### GET /api/v1/users/{userId}

`200` UserResponse；`404 USER_NOT_FOUND`。

### POST /api/v1/users

```json
{"userId": "USER0002", "firstName": "Ada", "lastName": "Lovelace",
 "password": "pass1234", "userType": "U"}
```

`201` UserResponse；`409 USER_ALREADY_EXISTS`；`400 VALIDATION_FAILED`（用户号 `^[A-Z0-9]{8}$`、
姓/名 1–20、密码 8–64、类型 `[AU]`）。

### PUT /api/v1/users/{userId}

```json
{"firstName": "Ada", "lastName": "Lovelace", "userType": "U", "password": "newpass1"}
```

`password` 可省略（保持不变）。`200`；`404`；`409 LAST_ADMIN`（将唯一管理员降级为 U）。

### DELETE /api/v1/users/{userId}

可选请求头 `X-User-Id`。`204`；`404`；`409 LAST_ADMIN`；`409 CANNOT_DELETE_SELF`
（`X-User-Id` 与目标相同）。

---

## 2. customer-service（:8082）

### GET /api/v1/customers?page=0&size=10

`200`：`{"items": [CustomerResponse...], "page": 0, "size": 10, "total": 8}`

`CustomerResponse`：

```json
{
  "customerId": "000000001",
  "firstName": "Immanuel", "middleName": "Madeline", "lastName": "Kessler",
  "addressLine1": "618 Deshaun Route", "addressLine2": "Apt. 802",
  "addressLine3": "Altenwerthshire",
  "stateCode": "NY", "countryCode": "USA", "zipCode": "10001",
  "phoneNumber1": "(212)555-0101", "phoneNumber2": null,
  "ssnMasked": "***-**-6789", "dateOfBirth": "1985-04-12",
  "eftAccountId": "0000000001", "primaryCardHolder": "Y",
  "ficoScore": 720, "version": 0
}
```

### GET /api/v1/customers/{customerId}

`200`；`404 CUSTOMER_NOT_FOUND`。

### POST /api/v1/customers

```json
{
  "customerId": "000000009", "firstName": "Grace", "middleName": "B",
  "lastName": "Hopper", "addressLine1": "1 Navy Way", "addressLine2": null,
  "addressLine3": "Arlington", "stateCode": "VA", "countryCode": "USA",
  "zipCode": "22201", "phoneNumber1": "7035550109", "phoneNumber2": null,
  "ssn": "123456789", "dateOfBirth": "1906-12-09", "eftAccountId": "0000000009",
  "primaryCardHolder": "N", "ficoScore": 800
}
```

`201`；`409 CUSTOMER_ALREADY_EXISTS`。`ssn` 只入不出。

### PUT /api/v1/customers/{customerId}

同 POST 的字段（`customerId` 来自路径，`ssn` 可选：省略表示不变）。`200`；`404`；`409`。

### 校验错误码

`400 VALIDATION_FAILED`，`details` 保留遗留文案，例如 `stateCode: State: is not a valid state code`。

---

## 3. card-service（:8083）

### GET /api/v1/cards?accountId=00000000001&customerId=&page=0&size=7

过滤条件均可选；`accountId` 11 位、`customerId` 9 位。
`200`：`{"items": [CardResponse...], "page": 0, "size": 7, "total": 2}`

`CardResponse`：`{"cardNumber","accountId","customerId","embossedName","expiryDate","activeStatus","version"}`
（**不返回 CVV**）。

### GET /api/v1/cards/{cardNumber}

`200` CardResponse；`404 CARD_NOT_FOUND`。

### GET /api/v1/cards/by-account/{accountId}

`200`：`{"items": [CardResponse...]}`（不分页，供内部调用与账户视图组合）。

### POST /api/v1/cards

```json
{"cardNumber":"6677889900112233","accountId":"00000000002","customerId":"000000002",
 "cvv":"123","embossedName":"ENRICO ROSENBAUM","expiryDate":"2029-08-11","activeStatus":"Y"}
```

`201`；`409 CARD_ALREADY_EXISTS`；`409 ACCOUNT_CUSTOMER_MISMATCH`（同一账户已存在的卡客户号不一致）。

### PUT /api/v1/cards/{cardNumber}

```json
{"embossedName": "ENRICO ROSENBAUM", "activeStatus": "Y",
 "expiryMonth": 8, "expiryYear": 2029}
```

`200`；`404`；`409 CONCURRENT_UPDATE`；`400 VALIDATION_FAILED`（卡名仅字母空格且必填、
状态 `[YN]`、月 1–12、年 1950–2099）。**CVV 不可修改**。

---

## 4. account-service（:8084）

### GET /api/v1/accounts

`200`：`{"items": [AccountResponse...]}`（8 条种子）。

### GET /api/v1/accounts/{accountId}

`200` AccountResponse；`404 ACCOUNT_NOT_FOUND`。

### PUT /api/v1/accounts/{accountId}

```json
{
  "activeStatus": "Y", "currentBalance": 1940.00, "creditLimit": 2020.00,
  "cashCreditLimit": 1020.00, "openDate": "2014-11-20",
  "expirationDate": "2025-05-20", "reissueDate": "2025-05-20",
  "currentCycleCredit": 0.00, "currentCycleDebit": 0.00,
  "addressZip": "10001", "groupId": "A000000000"
}
```

`200`；`404`；`400 VALIDATION_FAILED`；`409 CONCURRENT_UPDATE`。

### POST /api/v1/accounts/{accountId}/postings

```json
{"amount": 125.40}
```

`200` AccountResponse；`404`。语义：`currentBalance += amount`；`amount ≥ 0` 计入 `currentCycleCredit`，
否则计入 `currentCycleDebit`（BR-ACCT-09）。

### POST /api/v1/accounts/{accountId}/payments

```json
{"amount": 1940.00}
```

`200`；`404`；`409 NOTHING_TO_PAY`（余额 ≤ 0）；`409 PAYMENT_EXCEEDS_BALANCE`；`409 INVALID_PAYMENT_AMOUNT`。

### POST /api/v1/accounts/{accountId}/interest-accruals

```json
{"amount": 25.50}
```

`200`；`404`。语义：`currentBalance += amount`，`currentCycleCredit = currentCycleDebit = 0`。

---

## 5. transaction-service（:8085）

### GET /api/v1/transactions?idPrefix=&cardNumber=&accountId=&page=0&size=10

`200`：`{"items": [TransactionResponse...], "page": 0, "size": 10, "total": 6}`，按 `transactionId` 升序。

`TransactionResponse`：

```json
{
  "transactionId": "0000000000000001",
  "accountId": "00000000001",
  "cardNumber": "0500024453765740",
  "typeCode": "01", "typeDescription": "Purchase",
  "categoryCode": "0001", "categoryDescription": "Regular Sales Draft",
  "source": "POS TERM", "description": "Purchase at Abshire-Lowe", "amount": 50.47,
  "merchantId": "800000001", "merchantName": "Abshire-Lowe",
  "merchantCity": "Springfield", "merchantZip": "10001",
  "originalTimestamp": "2026-09-15T10:00:00",
  "processedTimestamp": "2026-09-15T10:00:00"
}
```

### GET /api/v1/transactions/{transactionId}

`200`；`404 TRANSACTION_NOT_FOUND`。

### POST /api/v1/transactions

```json
{
  "accountId": "00000000002",
  "cardNumber": null,
  "typeCode": "01",
  "categoryCode": "0001",
  "source": "POS TERM",
  "description": "Purchase at Test Merchant",
  "amount": 25.99,
  "originalDate": "2026-10-25",
  "processedDate": "2026-10-25",
  "merchantId": "800000123",
  "merchantName": "Test Merchant",
  "merchantCity": "Springfield",
  "merchantZip": "10001"
}
```

`201` TransactionResponse（`transactionId = max + 1`，16 位）；
`400 ACCOUNT_OR_CARD_REQUIRED`、`400 CARD_ACCOUNT_MISMATCH`、`400 VALIDATION_FAILED`、
`404 CARD_NOT_FOUND`（卡号路径）、`404 ACCOUNT_NOT_FOUND`、`409 DUPLICATE_TRANSACTION_ID`。

### POST /api/v1/postings

```json
{
  "transactions": [
    {
      "transactionId": "0000000000000100",
      "cardNumber": "0500024453765740",
      "typeCode": "01", "categoryCode": "0001", "source": "POS TERM",
      "description": "Purchase at Merchant A", "amount": 75.00,
      "originalTimestamp": "2026-10-25T10:15:00",
      "merchantId": "800000001", "merchantName": "Merchant A",
      "merchantCity": "Springfield", "merchantZip": "10001"
    }
  ]
}
```

`200`：

```json
{
  "status": "COMPLETED_WITH_REJECTS",
  "processed": 1, "posted": 0, "rejected": 1,
  "rejections": [{"transactionId": "0000000000000100", "reasonCode": 102,
                  "reason": "OVERLIMIT TRANSACTION"}],
  "duplicates": []
}
```

`duplicates` 列出重复提交且未重复记账的交易号（NR-POST-01）。

规则：卡不存在 → 100；账户不存在 → 101；`creditLimit < cycleCredit − cycleDebit + amount` → 102；
`account.expirationDate < originalTimestamp.date` → 103；通过则更新类别累计、调账户记账、写交易。
同一 `transactionId` 重复提交 → 计入 `posted` 并标记 `duplicate=true`（幂等，不重复记账）。

### POST /api/v1/interest-runs

```json
{"statementDate": "2026-10-25"}
```

`200`：

```json
{"statementDate": "2026-10-25", "accountsProcessed": 7, "interestPosted": 3,
 "totalInterest": 45.50, "details": [{"accountId": "00000000001", "interestAmount": 25.50}]}
```

规则：对 `tran_category_balance` 按账户分组；每个 `(账户,类型,类别)` 查披露组利率（缺失回退 `DEFAULT`），
`interest = balance × rate ÷ 1200`（HALF_UP，2 位）；按账户汇总后生成一笔交易（类型 01、类别 0005、
来源 `System`、描述 `Int. for a/c <accountId>`、卡号取该账户第一张卡），并调
`POST /accounts/{id}/interest-accruals`；交易号 = `yyyyMMdd` + 8 位序号。

### POST /api/v1/bill-payments

```json
{"accountId": "00000000001", "confirm": true}
```

`200`：`{"transactionId": "0000000000000200", "amount": 1940.00, "newBalance": 0.00}`
`409 CONFIRMATION_REQUIRED`（`confirm=false`）；`409 NOTHING_TO_PAY`；`404 ACCOUNT_NOT_FOUND`；
`503 DEPENDENCY_UNAVAILABLE`。

### GET /api/v1/reports/transactions?startDate=2026-09-01&endDate=2026-09-30&cardNumber=&page=0&size=50

`200`：

```json
{
  "items": [TransactionResponse...],
  "page": 0, "size": 50, "total": 6,
  "pageTotal": 2613.12,
  "accountTotals": [{"cardNumber": "0500024453765740", "total": 250.47}],
  "grandTotal": 2613.12
}
```

过滤：`processedTimestamp.date` 闭区间；可选 `cardNumber`。合计口径：`pageTotal` = 当前返回项之和；
`grandTotal` = 过滤范围内全部项之和；`accountTotals` = 按卡号分组（BR-RPT-02/03）。

### GET /api/v1/transaction-types

`200`：`{"items": [{"typeCode": "01", "description": "Purchase"}...]}`

### GET /api/v1/transaction-categories?typeCode=

`200`：`{"items": [{"typeCode": "01", "categoryCode": "0001", "description": "Regular Sales Draft"}...]}`

### PUT /api/v1/transaction-types/{typeCode}

```json
{"description": "Purchase"}
```

`200`；`404 TRANSACTION_TYPE_NOT_FOUND`。

---

## 6. authorization-service（:8086）

### POST /api/v1/authorizations

```json
{
  "cardNumber": "0500024453765740",
  "transactionAmount": 50.00,
  "authType": "01",
  "cardExpiryDate": "2805",
  "messageType": "0100",
  "messageSource": "POS",
  "processingCode": "000000",
  "merchantCategoryCode": "5411",
  "acquirerCountryCode": "USA",
  "posEntryMode": 5,
  "merchantId": "MERCHANT0000001",
  "merchantName": "Corner Grocery",
  "merchantCity": "Springfield",
  "merchantState": "IL",
  "merchantZip": "62704",
  "transactionId": "TXN000000000001",
  "authTimestamp": "2026-10-25T10:15:00"
}
```

除 `cardNumber`、`transactionAmount` 外均可选；`authTimestamp` 缺省为服务端当前时间。

`201`：

```json
{
  "authorizationId": "5f0c...",
  "cardNumber": "0500024453765740",
  "transactionId": "TXN000000000001",
  "authTimestamp": "2026-10-25T10:15:00",
  "responseCode": "00",
  "reasonCode": "0000",
  "approvedAmount": 50.00,
  "accountId": "00000000001",
  "customerId": "000000001",
  "fraudFlag": "N"
}
```

拒绝时 `responseCode=05`、`approvedAmount=0`、`reasonCode ∈ {3100,4100,4200,4300,5100,9000}`。
下游不可用 → `503 DEPENDENCY_UNAVAILABLE`（失败关闭，不批准）。

### GET /api/v1/pending-authorizations/{accountId}

`200`：

```json
{"accountId": "00000000001", "creditLimit": 2020.00, "cashLimit": 1020.00,
 "creditBalance": 50.00, "cashBalance": 0.00,
 "approvedCount": 1, "approvedAmount": 50.00,
 "declinedCount": 0, "declinedAmount": 0.00}
```

无汇总记录时返回 `404 AUTHORIZATION_SUMMARY_NOT_FOUND`。
可用额度口径（NR-AUTH-03）：`creditLimit − 账户当前余额 − creditBalance`。

### GET /api/v1/authorizations?accountId=00000000001&page=0&size=10

`200`：`{"items": [AuthorizationSummary...], "page": 0, "size": 10, "total": 1}`，
按 `authTimestamp` 倒序。

`AuthorizationSummary`：`{"authorizationId","cardNumber","authTimestamp","transactionId",
"transactionAmount","responseCode","reasonCode","approvedAmount","merchantName","fraudFlag"}`

### GET /api/v1/authorizations/{authorizationId}

`200` 完整明细（含请求字段与 `accountId/customerId/merchant*`）；`404 AUTHORIZATION_NOT_FOUND`。

### POST /api/v1/authorizations/{authorizationId}/fraud

`200`：`{"authorizationId":"...","fraudFlag":"Y","cardNumber":"...","cardBlocked":true}`
`404`；重复标记幂等。

### POST /api/v1/authorization-purges

```json
{"expiryDays": 5}
```

`200`：

```json
{"summariesRead": 3, "summariesDeleted": 1, "detailsRead": 5, "detailsDeleted": 4,
 "creditBalanceReleased": 120.00}
```

规则：`authTimestamp` 早于 `now − expiryDays`（缺省 5）的明细删除；删除批准的明细时
`creditBalance -= approvedAmount`（NR-AUTH-01）；汇总按剩余明细重算，批准与拒绝笔数均为 0 时删除汇总
（NR-AUTH-02）。

---

## 7. marketing-service（:8087，新增能力）

### 7.1 活动

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/campaigns?status=&page=&size=` | 活动列表（`status`：DRAFT/ACTIVE/PAUSED/ENDED） |
| GET | `/api/v1/campaigns/{id}` | 活动详情 |
| POST | `/api/v1/campaigns` | 新建（DRAFT） |
| PUT | `/api/v1/campaigns/{id}` | 编辑（仅 DRAFT，类型与计价字段需匹配） |
| POST | `/api/v1/campaigns/{id}/activate` `/pause` `/end` | 状态迁移 |
| GET | `/api/v1/campaigns/{id}/performance` | 报名数/发奖数/返现成本/预算使用率/转化率 |
| POST | `/api/v1/campaigns/{id}/enrollments` | 报名（同活动同卡幂等） |
| GET | `/api/v1/campaigns/{id}/enrollments?page=&size=` | 报名列表 |

创建请求示例（类别返现）：

```json
{
  "name": "周末餐饮 8% 返现",
  "description": "周末餐饮消费返现",
  "campaignType": "CATEGORY_CASHBACK",
  "startAt": "2026-11-01T00:00:00",
  "endAt": "2026-11-30T23:59:59",
  "categoryCode": "0001",
  "minTransactionAmount": 50.00,
  "rewardRate": 0.0800,
  "maxRewardPerTransaction": 40.00,
  "maxRewardsPerCard": 3,
  "budget": 5000.00,
  "enrollmentRequired": true
}
```

`201` 返回活动（`status=DRAFT`）。类型校验：`FIRST_PURCHASE_CASHBACK` 需 `fixedRewardAmount>0`；
`CATEGORY_CASHBACK` 需 `rewardRate>0` 或 `fixedRewardAmount>0`，且 `budget>0`；`POINTS_MULTIPLIER` 需 `pointsMultiplier>0`。
非法请求返回 `409 INVALID_CAMPAIGN_RULE` / `BUDGET_REQUIRED`；非法状态迁移返回 `409 INVALID_CAMPAIGN_STATE`；
过期活动发布返回 `409 CAMPAIGN_EXPIRED`。

活动效果响应：

```json
{"campaignId": "...", "enrolledCount": 2, "rewardCount": 3, "grantedCount": 2,
 "pendingCount": 1, "failedCount": 0, "cashbackTotal": 46.00, "pointsTotal": 0,
 "budget": 10000.00, "consumedAmount": 46.00, "budgetUtilization": 0.0046,
 "conversionRate": 1.0000}
```

### 7.2 活动中心与奖励

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/eligibilities?cardNumber=&accountId=&customerId=` | 当前有效活动、是否已报名、资格原因 |
| POST | `/api/v1/reward-evaluations` | 奖励评估（交易入账后调用，幂等） |
| GET | `/api/v1/rewards?accountId=&cardNumber=&campaignId=&page=&size=` | 奖励记录 |
| POST | `/api/v1/rewards/{rewardId}/fulfill` | 待入账返现重试（幂等） |
| GET | `/api/v1/marketing/summary` | 看板汇总（有效活动数/已发奖励/返现总额/积分/待处理） |

活动中心响应示例：

```json
{"items": [{
  "campaignId": "c0000000-0000-0000-0000-000000000002",
  "name": "餐饮消费 5% 返现", "campaignType": "CATEGORY_CASHBACK",
  "rewardSummary": "5% 返现，单笔上限 30.00", "rewardType": "CASHBACK",
  "rewardRate": 0.0500, "minTransactionAmount": 50.00, "maxRewardsPerCard": 5,
  "categoryCode": "0001", "startAt": "2026-09-01T00:00", "endAt": "2026-12-31T23:59:59",
  "remainingBudget": 10000.00, "enrollmentRequired": true,
  "enrolled": false, "eligible": false, "reason": "NOT_ENROLLED"
}]}
```

奖励评估请求：

```json
{"transactionId": "0000000000000777", "cardNumber": "3344556677889900",
 "accountId": "00000000006", "customerId": "000000006", "amount": 120.00,
 "categoryCode": "0001", "typeCode": "01", "description": "Dinner",
 "processedAt": "2026-10-25T19:30:00"}
```

响应 `{"grants": [...], "skipped": [{"campaignId","campaignName","reason"}]}`；
`reason` 取值：`ALREADY_EVALUATED`、`NOT_ENROLLED`、`CATEGORY_MISMATCH`、`AMOUNT_TOO_LOW`、
`CARD_LIMIT_REACHED`、`FIRST_PURCHASE_ALREADY_REWARDED`、`BUDGET_EXHAUSTED`、`ACCOUNT_INACTIVE`、
`ACCOUNT_GROUP_MISMATCH`、`ACCOUNT_NOT_FOUND`。

### 7.3 account-service 返现入账（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/accounts/{accountId}/cashback-credits` | 营销返现入账，`rewardId` 幂等冲减欠款 |

```json
{"rewardId": "7c1f0d4e-...", "campaignId": "c0000000-...", "amount": 6.00}
```

`200` 返回账户；同一 `rewardId` 重复调用不重复入账；金额 ≤ 0 返回 `409 INVALID_CASHBACK_AMOUNT`。

## 8. installment-service（:8088，REQ-2026-001）

> 认证：除 `preview` 外所有接口需 `Authorization: Bearer <IAM HMAC token>`；缺/坏/过期 `401 UNAUTHENTICATED`。
> 主体来自 token（userId/userType），不使用请求体自报身份。客户只能访问 `installment_account_access` 中的账户（越权 404）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/installments/preview` | 试算（不落库），返回 `previewToken`（30 分钟）、期次明细、`totalFee`、`firstPeriodTotal`、`availablePrincipal` |
| POST | `/api/v1/installments` | 创建分期；`201`，同一 `idempotencyKey` 重放 `200` 返回首次计划 |
| GET | `/api/v1/installments?accountId=&status=&page=&size=` | 我的/账户分期列表；`page≥1`、`1≤size≤100` |
| GET | `/api/v1/installments/{planId}` | 详情 + 还款计划；越权 `404 INSTALLMENT_NOT_FOUND` |
| POST | `/api/v1/installments/{planId}/early-settlement` | 提前结清；同 `settlementIdempotencyKey` 重放 `200` 首次结果，异键对非 ACTIVE `409 SETTLEMENT_NOT_ALLOWED` |
| GET | `/api/v1/admin/installments?accountId=&status=&page=&size=` | 后台查询（需 `STAFF_ASSIST` 或 `RISK_READONLY`） |
| POST | `/api/v1/admin/installments/exports?days=30` | 创建 CSV 导出（24 小时有效），返回 `exportId/rowCount/expiresAt` |
| GET | `/api/v1/admin/installments/exports/{exportId}` | 下载 CSV；过期 `410 EXPORT_EXPIRED` |
| POST | `/api/v1/admin/installments/eligibility-flags` | 维护交易逾期/争议信号（仅 `STAFF_ASSIST`） |

创建请求示例：

```json
{"idempotencyKey":"ins-20261027-001","accountId":"00000000006","sourceType":"TRANSACTION",
 "sourceId":"0000000000000200","principal":1000.00,"termMonths":6,
 "previewToken":"<base64url>.<base64url>","agreementAccepted":true}
```

计费口径（test-profile-v2）：1000.00/6 期手续费 5.50/4.58/3.67/2.75/1.83/0.92（合计 19.25，首期 172.16）；
500.00/3 期 3.00/2.00/1.00（合计 6.00，首期 169.66）；本金 166.66×5+166.70（末期吸收尾差）。

## 9. ledger-service（:8089）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/journal-entries` | 过账分录组；按 `entryGroupId` 幂等，重复提交 `200` + `duplicate=true` |
| GET | `/api/v1/journal-entries/{entryGroupId}` | 查询分录行 |

```json
{"entryGroupId":"IP…","businessType":"INSTALLMENT_CREATE","referenceId":"IP…",
 "lines":[{"accountCode":"1100-INSTALLMENT-RECEIVABLE","direction":"DEBIT","amount":1000.00,"memo":"principal"},
          {"accountCode":"4001-INSTALLMENT-FEE-INCOME","direction":"CREDIT","amount":19.25,"memo":"fee"}]}
```

## 10. 错误码总表

| code | HTTP | 归属 | 含义 |
|---|---|---|---|
| VALIDATION_FAILED | 400 | 全部 | 参数校验失败（`details` 给出字段与遗留文案） |
| INVALID_CREDENTIALS | 401 | iam | 用户号或密码错误 |
| USER_NOT_FOUND | 404 | iam | 用户不存在 |
| USER_ALREADY_EXISTS | 409 | iam | 用户号重复 |
| LAST_ADMIN | 409 | iam | 不允许删除/降级最后一个管理员 |
| CANNOT_DELETE_SELF | 409 | iam | 不允许删除自己 |
| CUSTOMER_NOT_FOUND | 404 | customer | 客户不存在 |
| CUSTOMER_ALREADY_EXISTS | 409 | customer | 客户号重复 |
| CARD_NOT_FOUND | 404 | card | 卡号不存在 |
| CARD_ALREADY_EXISTS | 409 | card | 卡号重复 |
| ACCOUNT_CUSTOMER_MISMATCH | 409 | card | 卡与账户/客户归属不一致 |
| ACCOUNT_NOT_FOUND | 404 | account | 账户不存在 |
| NOTHING_TO_PAY | 409 | account/transaction | 无欠款，不能还款 |
| PAYMENT_EXCEEDS_BALANCE | 409 | account | 还款金额超过余额 |
| INVALID_PAYMENT_AMOUNT | 409 | account | 还款金额 ≤ 0 |
| CONCURRENT_UPDATE | 409 | account/card | 乐观锁冲突 |
| TRANSACTION_NOT_FOUND | 404 | transaction | 交易不存在 |
| DUPLICATE_TRANSACTION_ID | 409 | transaction | 交易号重复 |
| ACCOUNT_OR_CARD_REQUIRED | 400 | transaction | 账户号与卡号至少一个 |
| CARD_ACCOUNT_MISMATCH | 400 | transaction | 卡号与账户号不匹配 |
| TRANSACTION_TYPE_NOT_FOUND | 404 | transaction | 交易类型不存在 |
| REPORT_REFERENCE_ERROR | 409 | transaction | 报表引用完整性失败 |
| CONFIRMATION_REQUIRED | 409 | transaction | 支付未确认 |
| BILL_PAYMENT_CARD_NOT_FOUND | 409 | transaction | 账户下无卡，无法账单支付 |
| AUTHORIZATION_NOT_FOUND | 404 | authorization | 授权记录不存在 |
| AUTHORIZATION_SUMMARY_NOT_FOUND | 404 | authorization | 该账户无待授权汇总 |
| CAMPAIGN_NOT_FOUND | 404 | marketing | 活动不存在 |
| CAMPAIGN_NOT_EDITABLE | 409 | marketing | 非草稿活动不可编辑 |
| INVALID_CAMPAIGN_RULE | 409 | marketing | 活动类型与计价字段不匹配 |
| INVALID_CAMPAIGN_STATE | 409 | marketing | 非法状态迁移 |
| CAMPAIGN_EXPIRED | 409 | marketing | 活动已过期，无法发布 |
| BUDGET_REQUIRED | 409 | marketing | 返现活动必须有正预算 |
| BUDGET_EXHAUSTED | 409 | marketing | 活动预算已用完 |
| CAMPAIGN_NOT_ACTIVE | 409 | marketing | 非进行中活动不能报名 |
| REWARD_NOT_FOUND | 404 | marketing | 奖励记录不存在 |
| INVALID_CASHBACK_AMOUNT | 409 | account | 返现金额必须大于 0 |
| DEPENDENCY_UNAVAILABLE | 503 | transaction/authorization/marketing/installment | 下游服务不可用 |
| INSTALLMENT_NOT_ELIGIBLE | 409 | installment | 金额不足、状态不支持、已逾期/争议中 |
| ALREADY_INSTALLED | 409 | installment | 本金已存在生效计划（含单笔/账单交叉占用） |
| INSTALLMENT_LIMIT_EXCEEDED | 409 | installment | 单账户 ACTIVE 分期达 20 笔 |
| PREVIEW_EXPIRED | 409 | installment | 试算令牌过期或与请求不一致 |
| PRINCIPAL_EXCEEDS_LIMIT | 409 | installment | 本金超过可分期本金余额 |
| SETTLEMENT_NOT_ALLOWED | 409 | installment | 计划非 ACTIVE 且非同一结清幂等键重放 |
| CONCURRENT_MODIFICATION | 409 | installment | 计划状态并发变更（乐观锁） |
| IDEMPOTENCY_KEY_CONFLICT | 409 | installment | 去重键/结清键已被其它账户或计划使用 |
| AGREEMENT_REQUIRED | 400 | installment | 未勾选分期协议 |
| INVALID_PARAMETER | 400 | installment | 分页/枚举/类型参数非法 |
| INVALID_TERM | 400 | installment | 期数不在 3/6/12 |
| INSTALLMENT_NOT_FOUND | 404 | installment | 计划/交易不存在或越权 |
| SCHEDULE_INCONSISTENT | 200 | installment | 还款计划缺失告警（随计划返回） |
| EXPORT_EXPIRED | 410 | installment | 导出文件超过 24 小时有效期 |
| EXPORT_NOT_FOUND | 404 | installment | 导出文件不存在 |
| UNAUTHENTICATED | 401 | installment | 无/非法/过期 IAM token |
| FORBIDDEN | 403 | installment | 无后台权限点或只读身份请求写操作 |
