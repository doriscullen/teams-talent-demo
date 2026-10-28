> v2 节点资料：以下原始章节/历史基线摘录保持原意。当前本地测试参数以本目录 `test-profile.md` v2 为准；正式第 12.3 节仍待确认。不得自行把其它推断政策转成已确认。

# REQ-2026-002 · 企业测试用例定义与验收

来源：原始需求 §9 场景矩阵与 §10 验收标准。原始摘录保持不变；当前用例投影版本 REQ-2026-002-cases-v2（原 REQ-2026-002-cases-v1）。以下均为待执行用例，不是已运行报告；存在冲突的期望必须关联PRD决策，禁止直接标通过。测试资产插件提供用例，Talent提供验证知识与Skill。

## 9. 场景矩阵

| 类型 | 场景 | 角色 | 数据/接口 | 预期 |
|------|------|------|-----------|------|
| 主流程 | `ACTIVE` 卡挂失 | 持卡人 | POST `/cards/4000000000005740/loss` | 201，`cardStatus=LOST`，`card_operation` 新增 1 条，通知发出 |
| 主流程 | 挂失后申请补卡（金卡） | 持卡人 | POST `/cards/{cardNumber}/replacements` | 201，工单 `REQUESTED`，`feeAmount=50.00`，FEE 过账成功 |
| 主流程 | 运营更新为 `SHIPPED` | 制卡运营 | POST `/admin/replacements/{id}/status` | 200，客户进度页展示快递单号与预计到达日期 |
| 边界 | 白金卡申请补卡 | 持卡人 | 白金卡工单，`feeAmount=0.00` | `feeStatus=WAIVED`，无 FEE 过账 |
| 边界 | 卡片刚挂失 1 秒内立即申请补卡 | 持卡人 | POST `/replacements` | 201，工单创建成功，状态 `REQUESTED` |
| 边界 | 同一去重键在 30 分钟窗内第 3 次提交 | 持卡人 | POST `/replacements`，去重键固定 | 返回同一 `replacement_id`，工单数不变 |
| 异常 | 已挂失卡再次挂失 | 持卡人 | POST `/loss` | 409 `CARD_ALREADY_LOST`，审计仅 1 条 LOSS 记录 |
| 异常 | 补卡进行中再次申请 | 持卡人 | POST `/replacements` | 409 `REPLACEMENT_EXISTS` |
| 异常 | 费用过账时 transaction-service 不可用 | 持卡人 | 停用 transaction-service 后申请补卡 | 工单存在且 `feeStatus=FEE_PENDING`，恢复后自动补收 |
| 异常 | 运营在 `REQUESTED` 直接置 `ACTIVATED` | 制卡运营 | POST `/admin/replacements/{id}/status` | 409 `INVALID_STATE_TRANSITION` |
| 权限 | 客户 A 查看客户 B 的补卡工单 | 持卡人 | GET `/replacements/{id}` | 404，「补卡记录不存在」 |
| 权限 | 客服代客挂失 | 客服 | POST `/loss`，token 含 `card:loss:assist` | 201，审计 actor 为客服工号，记录核实方式 |

## 10. 验收标准（可执行化）

| 故事 | Given | When | Then | 数据准备 |
|------|-------|------|------|---------|
| US-001 | 存在 `ACTIVE` 卡 4000000000005740 | 客户确认挂失 | 卡状态立即 `LOST`，旧卡授权被拒，审计可查 | 卡与账户 00000000006 |
| US-002 | 卡已 `LOST` | 再次提交挂失 | 409 `CARD_ALREADY_LOST`，通知仅 1 条 | 复用 US-001 数据 |
| US-003 | 白金卡已挂失 | 提交补卡申请 | `feeAmount=0.00`、`feeStatus=WAIVED`，无 FEE 过账 | 白金卡 4000000000009999 |
| US-004 | 金卡已挂失 | 提交补卡申请 | `feeAmount=50.00`，生成 FEE 过账，`fee_batch_id` 回填 | 金卡 4000000000005740 |
| US-005 | 存在进行中补卡工单 | 再次提交补卡 | 409 `REPLACEMENT_EXISTS`，工单数不变 | 复用 US-004 数据 |
| US-006 | 工单状态 `CARD_PRODUCED` | 运营更新为 `SHIPPED` 并回填单号 | 客户进度页展示快递单号与预计到达日期 | 工单 `replacement_id` |
| US-007 | 新卡已生成未激活 | 用新卡发起交易 | 交易被拒，提示「新卡未激活」 | 新卡号 + 交易请求 |
| US-008 | 停用 transaction-service | 提交金卡补卡申请 | 工单创建成功且 `feeStatus=FEE_PENDING`；恢复后 24 小时内补收成功 | 停用与恢复容器 |

## 执行证据要求

功能测试、静态工具检查、Agent Review、安全报告和问题复测分别记录实际命令/工具版本/代码commit/退出码/报告路径。Owner验收依据为这些实际结果；知识发布不表示已验收。

## test-profile-v2 补充（不是新增原文AC）

REQUESTED取消：已收费50按原交易冲回一次；FEE_PENDING取消补收；减免0无退费。覆盖取消/收费重试并发和重复取消。卡号仅用本地种子BIN+16位Luhn唯一性，不宣称卡组织认证。
全部原US-001..008继续保留；真实执行报告需分清原AC与本profile补充用例。
