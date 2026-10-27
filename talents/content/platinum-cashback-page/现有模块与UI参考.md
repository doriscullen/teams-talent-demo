# 已核实模块与 UI 开发参考

以下为仓库 `workspace/carddemo-java-1025` 的源码事实，核验文件与 SHA-256 见同产物 `provenance.json`。它们是实现参考，不表示本需求已开发完成。

## 实际前端技术与入口

- `services/web-ui/src/main/resources/static/app.js` 是无框架的浏览器 JavaScript 单页应用，不是 React/TypeScript 页面。`route()` 使用 hash 路由；`#/cards/<cardNumber>` 调用 `pageCardDetail(cardNumber)`。
- `pageCardDetail` 通过 `api('/api/v1/cards/'+encodeURIComponent(cardNumber))` 读取卡片详情，调用 `shell` 渲染标题与内容。新增权益入口应在该详情范围设计，不能替换卡片维护表单或把全站活动中心当作本需求完成。
- `esc` 用于 HTML 字符转义，`api` 统一处理 token 和错误，`errBox` 展示错误；新增来自数据/文案的内容应沿用这些实际入口并考虑 DOM 注入风险。
- `services/web-ui/src/main/resources/static/styles.css` 定义现有 `.card`、`.grid`、`.btn`、`.hint`、`.alert` 等样式。复用实际布局/响应式约定，不无故引入另一套 UI 框架。
- `services/web-ui/src/main/resources/static/index.html` 载入现有 `styles.css` 与 `app.js`。

## 真实卡片接口边界

`services/card-service/src/main/java/com/carddemo/card/interfaces/rest/CardController.java` 暴露 `GET /api/v1/cards/{cardNumber}`。响应定义于 `interfaces/rest/dto/CardResponse.java`：`cardNumber`、`accountId`、`customerId`、`embossedName`、`expiryDate`、`activeStatus`、`version`。

当前响应没有白金等级或权益资格字段，`activeStatus` 仅表示卡片状态，不能据此判定白金。设计必须明确资格来源：新增明确契约、复用经核验的另一来源，或仅在隔离验证中使用标记清楚的输入夹具。不要在生产页面把验证夹具当作已存在服务。

## 本轮不修改的链路

`services/marketing-service` 的活动/奖励接口、`services/transaction-service` 的交易与入账逻辑属于既有执行链。`app.js` 中 `pageOffers` 的报名和活动表单默认日期/比例不能当成本需求政策依据；只查看权益说明不得调用报名、奖励评估、交易写入或入账接口。

代码与报告须引用实际提交/代码版本。本文仅给源码定位，没有本需求的 PR、提交、PRD 或测试结果。
