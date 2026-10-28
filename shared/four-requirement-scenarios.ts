/** Reviewed source fixtures. Exact business identity is separate from runtime task UUID. */
export type FourRequirementNode = 'prepare'|'develop'|'verify'|'accept';
export const fourRequirementScenarios = [
  {
    "businessId": "REQ-2026-001",
    "id": "req-2026-001-v1",
    "projectId": "carddemo",
    "title": "信用卡账单/消费分期",
    "artifactId": "a-req-2026-001",
    "version": 1,
    "sourceFile": "REQ-2026-001-installment.md",
    "sourceSha256": "6d6a04c8b7e5b87a17429b0125f9485ee11a96d370e2e90944f309774e479e13",
    "manifest": "four-requirements/REQ-2026-001/provenance.json",
    "files": {
      "requirement": "four-requirements/REQ-2026-001/原始需求.md",
      "rules": "four-requirements/REQ-2026-001/业务规则与范围.md",
      "questions": "four-requirements/REQ-2026-001/待确认与差异.md",
      "implementation": "four-requirements/REQ-2026-001/基线与实现约束.md",
      "acceptance": "four-requirements/REQ-2026-001/测试定义与验收.md",
      "profile": "four-requirements/REQ-2026-001/test-profile.md"
    },
    "creationDescription": "业务需求编号：REQ-2026-001\n原始需求 SHA256：6d6a04c8b7e5b87a17429b0125f9485ee11a96d370e2e90944f309774e479e13\n完整需求：Talents发布资料 four-requirements/REQ-2026-001/原始需求.md（原文v1.0）。\n范围：信用卡账单/消费分期，必须读取完整原文全部13章后开展；当前任务摘要不缩减功能、接口、数据、安全与验收范围。第5章明确模拟值用于本次测试；第12.3事项保留投产待确认，内部矛盾按资料差异清单澄清，不伪造Owner确认。",
    "casesVersion": "REQ-2026-001-cases-v1",
    "cases": [
      {
        "id": "REQ-2026-001-US-001",
        "title": "US-001 · 存在 1000.00 元已入账消费，账户额度 20000.00",
        "given": "存在 1000.00 元已入账消费，账户额度 20000.00；数据准备：交易 0000000000000200，账户 00000000006",
        "steps": "选择 6 期试算并提交",
        "expected": "依据 test-profile-v1：前5期本金166.66、末期166.70；各期手续费5.50/4.58/3.67/2.75/1.83/0.92，合计19.25；首期172.16，计划ACTIVE。原文总费33.00保留在原始文件。",
        "sourceSection": "§10 US-001"
      },
      {
        "id": "REQ-2026-001-US-002",
        "title": "US-002 · 已用去重键 `ins-20261027-001` 创建过计划",
        "given": "已用去重键 `ins-20261027-001` 创建过计划；数据准备：复用 US-001 数据",
        "steps": "用同一去重键再次提交",
        "expected": "返回同一 plan_id，`installment_plan` 与账务分录数不变",
        "sourceSection": "§10 US-002"
      },
      {
        "id": "REQ-2026-001-US-003",
        "title": "US-003 · 交易已分期",
        "given": "交易已分期；数据准备：复用 US-001 数据",
        "steps": "再次申请分期",
        "expected": "409 `ALREADY_INSTALLED`，页面展示「已分期」徽标",
        "sourceSection": "§10 US-003"
      },
      {
        "id": "REQ-2026-001-US-004",
        "title": "US-004 · 计划创建成功",
        "given": "计划创建成功；数据准备：复用 US-001 数据",
        "steps": "查询账户额度视图与计划详情",
        "expected": "分期占用 = 1000.00，还款计划 6 行合计 = 本金 + 手续费",
        "sourceSection": "§10 US-004"
      },
      {
        "id": "REQ-2026-001-US-005",
        "title": "US-005 · 计划剩余本金 600.00，`ACTIVE`",
        "given": "计划剩余本金 600.00，`ACTIVE`；数据准备：计划 3 期已还 1 期",
        "steps": "提前结清",
        "expected": "剩余本金归零、额度释放 600.00、违约金 6.00 过账 ledger",
        "sourceSection": "§10 US-005"
      },
      {
        "id": "REQ-2026-001-US-006",
        "title": "US-006 · 交易金额 99.99",
        "given": "交易金额 99.99；数据准备：交易 0000000000000201",
        "steps": "打开交易详情",
        "expected": "入口置灰，提示「单笔消费满 100.00 元可申请分期」",
        "sourceSection": "§10 US-006"
      },
      {
        "id": "REQ-2026-001-US-007",
        "title": "US-007 · ledger-service 已停用",
        "given": "ledger-service 已停用；数据准备：停用 ledger 容器",
        "steps": "提交分期",
        "expected": "503 `DOWNSTREAM_UNAVAILABLE`，无半完成资金状态",
        "sourceSection": "§10 US-007"
      },
      {
        "id": "REQ-2026-001-US-008",
        "title": "US-008 · 运营账号持有 `installment:read:any`",
        "given": "运营账号持有 `installment:read:any`；数据准备：30 天计划数据 ≥ 20 条",
        "steps": "导出 30 天分期清单",
        "expected": "生成 CSV，24 小时内可下载，审计记录导出动作",
        "sourceSection": "§10 US-008"
      }
    ]
  },
  {
    "businessId": "REQ-2026-002",
    "id": "req-2026-002-v1",
    "projectId": "carddemo",
    "title": "信用卡挂失与补卡",
    "artifactId": "a-req-2026-002",
    "version": 1,
    "sourceFile": "REQ-2026-002-card-loss.md",
    "sourceSha256": "3a4ab0444d948b2b8fa2bb2cf7c71cab0e0c2573c2b8dbbeb8ae4937c85744e9",
    "manifest": "four-requirements/REQ-2026-002/provenance.json",
    "files": {
      "requirement": "four-requirements/REQ-2026-002/原始需求.md",
      "rules": "four-requirements/REQ-2026-002/业务规则与范围.md",
      "questions": "four-requirements/REQ-2026-002/待确认与差异.md",
      "implementation": "four-requirements/REQ-2026-002/基线与实现约束.md",
      "acceptance": "four-requirements/REQ-2026-002/测试定义与验收.md",
      "profile": "four-requirements/REQ-2026-002/test-profile.md"
    },
    "creationDescription": "业务需求编号：REQ-2026-002\n原始需求 SHA256：3a4ab0444d948b2b8fa2bb2cf7c71cab0e0c2573c2b8dbbeb8ae4937c85744e9\n完整需求：Talents发布资料 four-requirements/REQ-2026-002/原始需求.md（原文v1.0）。\n范围：信用卡挂失与补卡，必须读取完整原文全部13章后开展；当前任务摘要不缩减功能、接口、数据、安全与验收范围。第5章明确模拟值用于本次测试；第12.3事项保留投产待确认，内部矛盾按资料差异清单澄清，不伪造Owner确认。",
    "casesVersion": "REQ-2026-002-cases-v1",
    "cases": [
      {
        "id": "REQ-2026-002-US-001",
        "title": "US-001 · 存在 `ACTIVE` 卡 4000000000005740",
        "given": "存在 `ACTIVE` 卡 4000000000005740；数据准备：卡与账户 00000000006",
        "steps": "客户确认挂失",
        "expected": "卡状态立即 `LOST`，旧卡授权被拒，审计可查",
        "sourceSection": "§10 US-001"
      },
      {
        "id": "REQ-2026-002-US-002",
        "title": "US-002 · 卡已 `LOST`",
        "given": "卡已 `LOST`；数据准备：复用 US-001 数据",
        "steps": "再次提交挂失",
        "expected": "409 `CARD_ALREADY_LOST`，通知仅 1 条",
        "sourceSection": "§10 US-002"
      },
      {
        "id": "REQ-2026-002-US-003",
        "title": "US-003 · 白金卡已挂失",
        "given": "白金卡已挂失；数据准备：白金卡 4000000000009999",
        "steps": "提交补卡申请",
        "expected": "`feeAmount=0.00`、`feeStatus=WAIVED`，无 FEE 过账",
        "sourceSection": "§10 US-003"
      },
      {
        "id": "REQ-2026-002-US-004",
        "title": "US-004 · 金卡已挂失",
        "given": "金卡已挂失；数据准备：金卡 4000000000005740",
        "steps": "提交补卡申请",
        "expected": "`feeAmount=50.00`，生成 FEE 过账，`fee_batch_id` 回填",
        "sourceSection": "§10 US-004"
      },
      {
        "id": "REQ-2026-002-US-005",
        "title": "US-005 · 存在进行中补卡工单",
        "given": "存在进行中补卡工单；数据准备：复用 US-004 数据",
        "steps": "再次提交补卡",
        "expected": "409 `REPLACEMENT_EXISTS`，工单数不变",
        "sourceSection": "§10 US-005"
      },
      {
        "id": "REQ-2026-002-US-006",
        "title": "US-006 · 工单状态 `CARD_PRODUCED`",
        "given": "工单状态 `CARD_PRODUCED`；数据准备：工单 `replacement_id`",
        "steps": "运营更新为 `SHIPPED` 并回填单号",
        "expected": "客户进度页展示快递单号与预计到达日期",
        "sourceSection": "§10 US-006"
      },
      {
        "id": "REQ-2026-002-US-007",
        "title": "US-007 · 新卡已生成未激活",
        "given": "新卡已生成未激活；数据准备：新卡号 + 交易请求",
        "steps": "用新卡发起交易",
        "expected": "交易被拒，提示「新卡未激活」",
        "sourceSection": "§10 US-007"
      },
      {
        "id": "REQ-2026-002-US-008",
        "title": "US-008 · 停用 transaction-service",
        "given": "停用 transaction-service；数据准备：停用与恢复容器",
        "steps": "提交金卡补卡申请",
        "expected": "工单创建成功且 `feeStatus=FEE_PENDING`；恢复后 24 小时内补收成功",
        "sourceSection": "§10 US-008"
      }
    ]
  },
  {
    "businessId": "REQ-2026-003",
    "id": "req-2026-003-v1",
    "projectId": "carddemo",
    "title": "信用卡额度调整申请与审批",
    "artifactId": "a-req-2026-003",
    "version": 1,
    "sourceFile": "REQ-2026-003-limit-increase.md",
    "sourceSha256": "a2c7283973c6cb115e9a8da5ba0154019b9ad84bb4f852b50abbb989130b5d01",
    "manifest": "four-requirements/REQ-2026-003/provenance.json",
    "files": {
      "requirement": "four-requirements/REQ-2026-003/原始需求.md",
      "rules": "four-requirements/REQ-2026-003/业务规则与范围.md",
      "questions": "four-requirements/REQ-2026-003/待确认与差异.md",
      "implementation": "four-requirements/REQ-2026-003/基线与实现约束.md",
      "acceptance": "four-requirements/REQ-2026-003/测试定义与验收.md",
      "profile": "four-requirements/REQ-2026-003/test-profile.md"
    },
    "creationDescription": "业务需求编号：REQ-2026-003\n原始需求 SHA256：a2c7283973c6cb115e9a8da5ba0154019b9ad84bb4f852b50abbb989130b5d01\n完整需求：Talents发布资料 four-requirements/REQ-2026-003/原始需求.md（原文v1.0）。\n范围：信用卡额度调整申请与审批，必须读取完整原文全部13章后开展；当前任务摘要不缩减功能、接口、数据、安全与验收范围。第5章明确模拟值用于本次测试；第12.3事项保留投产待确认，内部矛盾按资料差异清单澄清，不伪造Owner确认。",
    "casesVersion": "REQ-2026-003-cases-v1",
    "cases": [
      {
        "id": "REQ-2026-003-US-001",
        "title": "US-001 · 当前额度 8000、产品上限 25000、无逾期、开卡 24 个月",
        "given": "当前额度 8000、产品上限 25000、无逾期、开卡 24 个月；数据准备：账户 00000000006",
        "steps": "申请 12000 并由初审与终审通过",
        "expected": "状态 `APPROVED`，account 额度 12000，客户收到通知",
        "sourceSection": "§10 US-001"
      },
      {
        "id": "REQ-2026-003-US-002",
        "title": "US-002 · 近 6 个月存在 1 个月逾期",
        "given": "近 6 个月存在 1 个月逾期；数据准备：账单逾期数据 1 条",
        "steps": "提交申请 12000",
        "expected": "预审 `REJECTED`，展示「近 6 个月存在逾期记录」",
        "sourceSection": "§10 US-002"
      },
      {
        "id": "REQ-2026-003-US-003",
        "title": "US-003 · 已存在进行中申请",
        "given": "已存在进行中申请；数据准备：复用 US-001 数据",
        "steps": "再次提交申请",
        "expected": "409 `LIMIT_APPLICATION_EXISTS`，申请表仅 1 条",
        "sourceSection": "§10 US-003"
      },
      {
        "id": "REQ-2026-003-US-004",
        "title": "US-004 · 初审人与终审人为同一账号",
        "given": "初审人与终审人为同一账号；数据准备：单账号双角色配置",
        "steps": "执行终审",
        "expected": "403 `SOD_VIOLATION`，申请状态不变",
        "sourceSection": "§10 US-004"
      },
      {
        "id": "REQ-2026-003-US-005",
        "title": "US-005 · 申请 8000→16000.01",
        "given": "申请 8000→16000.01；数据准备：US-001 账户 + 材料",
        "steps": "提交并进入审批",
        "expected": "`dualApprovalRequired=true`，缺第二审批人时返回 `DUAL_APPROVAL_REQUIRED`",
        "sourceSection": "§10 US-005"
      },
      {
        "id": "REQ-2026-003-US-006",
        "title": "US-006 · 审批通过后 account-service 停用",
        "given": "审批通过后 account-service 停用；数据准备：停用与恢复容器",
        "steps": "执行终审",
        "expected": "状态 `APPROVED_PENDING`；恢复服务后自动生效且仅 1 次额度更新",
        "sourceSection": "§10 US-006"
      },
      {
        "id": "REQ-2026-003-US-007",
        "title": "US-007 · 申请被拒绝",
        "given": "申请被拒绝；数据准备：US-002 数据",
        "steps": "打开客户进度页",
        "expected": "展示拒绝原因与客服入口，拒绝原因为空时提交被拦截",
        "sourceSection": "§10 US-007"
      },
      {
        "id": "REQ-2026-003-US-008",
        "title": "US-008 · 开卡 2 个月的账户",
        "given": "开卡 2 个月的账户；数据准备：新开户 00000000007",
        "steps": "提交提额申请",
        "expected": "预审拒绝，提示「开卡满 3 个月后可申请提额」",
        "sourceSection": "§10 US-008"
      }
    ]
  },
  {
    "businessId": "REQ-2026-004",
    "id": "req-2026-004-v1",
    "projectId": "carddemo",
    "title": "交易争议在线申请与处理",
    "artifactId": "a-req-2026-004",
    "version": 1,
    "sourceFile": "REQ-2026-004-dispute.md",
    "sourceSha256": "341b329ed87b60ccc4a241423a5f76c0243e45f5e9737269e095a72b5cec1484",
    "manifest": "four-requirements/REQ-2026-004/provenance.json",
    "files": {
      "requirement": "four-requirements/REQ-2026-004/原始需求.md",
      "rules": "four-requirements/REQ-2026-004/业务规则与范围.md",
      "questions": "four-requirements/REQ-2026-004/待确认与差异.md",
      "implementation": "four-requirements/REQ-2026-004/基线与实现约束.md",
      "acceptance": "four-requirements/REQ-2026-004/测试定义与验收.md",
      "profile": "four-requirements/REQ-2026-004/test-profile.md"
    },
    "creationDescription": "业务需求编号：REQ-2026-004\n原始需求 SHA256：341b329ed87b60ccc4a241423a5f76c0243e45f5e9737269e095a72b5cec1484\n完整需求：Talents发布资料 four-requirements/REQ-2026-004/原始需求.md（原文v1.0）。\n范围：交易争议在线申请与处理，必须读取完整原文全部13章后开展；当前任务摘要不缩减功能、接口、数据、安全与验收范围。第5章明确模拟值用于本次测试；第12.3事项保留投产待确认，内部矛盾按资料差异清单澄清，不伪造Owner确认。",
    "casesVersion": "REQ-2026-004-cases-v1",
    "cases": [
      {
        "id": "REQ-2026-004-US-001",
        "title": "US-001 · 90 天内已入账交易 299.00，无进行中争议",
        "given": "90 天内已入账交易 299.00，无进行中争议；数据准备：交易 0000000000000200，账户 00000000006",
        "steps": "提交 FRAUD 争议并上传 1 份 PDF",
        "expected": "案件 `OPEN`，客户可查看时间线与 SLA 到期时间",
        "sourceSection": "§10 US-001"
      },
      {
        "id": "REQ-2026-004-US-002",
        "title": "US-002 · 同一交易已有 `OPEN` 案件",
        "given": "同一交易已有 `OPEN` 案件；数据准备：复用 US-001 数据",
        "steps": "再次开案",
        "expected": "409 `DISPUTE_EXISTS`，案件数不变",
        "sourceSection": "§10 US-002"
      },
      {
        "id": "REQ-2026-004-US-003",
        "title": "US-003 · 交易尚未上传证据",
        "given": "交易尚未上传证据；数据准备：复用 US-001 数据",
        "steps": "提交 FRAUD 争议",
        "expected": "409 `EVIDENCE_REQUIRED`",
        "sourceSection": "§10 US-003"
      },
      {
        "id": "REQ-2026-004-US-004",
        "title": "US-004 · 案件 `UNDER_REVIEW`",
        "given": "案件 `UNDER_REVIEW`；数据准备：案件号 + 账户余额初始值",
        "steps": "临时入账 100.00 并重复提交",
        "expected": "账户贷记 100.00 一次，案件 `PROVISIONAL_CREDIT`",
        "sourceSection": "§10 US-004"
      },
      {
        "id": "REQ-2026-004-US-005",
        "title": "US-005 · 案件已临时入账",
        "given": "案件已临时入账；数据准备：复用 US-004 数据",
        "steps": "发起 chargeback 并结案 `won=true`",
        "expected": "状态 `WON` 后 `CLOSED`，客户收到通知，审计完整",
        "sourceSection": "§10 US-005"
      },
      {
        "id": "REQ-2026-004-US-006",
        "title": "US-006 · 案件距 SLA 到期 23 小时",
        "given": "案件距 SLA 到期 23 小时；数据准备：调整 `sla_due_at` 数据",
        "steps": "执行每日 02:00 扫描",
        "expected": "专员与主管收到提醒，`slaState=DUE_SOON`",
        "sourceSection": "§10 US-006"
      },
      {
        "id": "REQ-2026-004-US-007",
        "title": "US-007 · 交易入账 91 天前",
        "given": "交易入账 91 天前；数据准备：交易 0000000000000199",
        "steps": "打开交易详情",
        "expected": "入口置灰，提示「超过 90 天的交易请致电客服」",
        "sourceSection": "§10 US-007"
      },
      {
        "id": "REQ-2026-004-US-008",
        "title": "US-008 · account-service 停用",
        "given": "account-service 停用；数据准备：停用容器",
        "steps": "发起临时入账 299.00",
        "expected": "503 `DOWNSTREAM_UNAVAILABLE`，案件保持 `UNDER_REVIEW`，余额不变",
        "sourceSection": "§10 US-008"
      }
    ]
  }
] as const;
export type FourRequirementScenario = Omit<typeof fourRequirementScenarios[number], 'id'|'artifactId'|'version'|'manifest'|'files'|'creationDescription'|'casesVersion'|'cases'> & {
 id:string;artifactId:string;version:number;manifest:string;files:Record<keyof typeof fourRequirementScenarios[number]['files'],string>;creationDescription:string;casesVersion:string;
 cases:ReadonlyArray<{id:string;title:string;given:string;steps:string;expected:string;sourceSection:string}>;profileSha256?:string;
};
/** v1 is immutable. New tasks must explicitly pin both v2 and its profile digest. */
export const fourRequirementProfileV2Sha256 = 'b77c194258178a08ffd90beccb5e0f038472e69615655440bdc2493b2b3813cd';
export const fourRequirementScenariosV2: readonly FourRequirementScenario[] = fourRequirementScenarios.map(source=>({
 ...source,id:source.id.replace(/-v1$/,'-v2'),artifactId:source.artifactId+'-v2',version:2,
 manifest:`four-requirements/${source.businessId}/v2/provenance.json`,
 files:{...source.files,...Object.fromEntries(Object.entries(source.files).filter(([key])=>key!=='requirement').map(([key,path])=>[key,path.replace(/\/([^/]+)$/,'/v2/$1')]))},
 profileSha256:fourRequirementProfileV2Sha256,
 creationDescription:source.creationDescription+'\n试验口径版本：test-profile-v2\n试验口径 SHA256：'+fourRequirementProfileV2Sha256+'\n本任务明确锁定 v2 本地测试口径；原文全部13章及原US-001..008必须保留。除已明确测试参数外，其它待定政策须报告协调者，不得自行标为必须/已确认。',
 casesVersion:source.casesVersion.replace(/-v1$/,'-v2'),
 cases:source.cases.map(item=>source.businessId==='REQ-2026-001'&&item.id.endsWith('US-005')?{...item,given:'900.00元分3期，已实际归还首期本金300.00，计划ACTIVE且剩余本金600.00；保留原US-005条件，不以500/3替换',expected:'剩余本金归零，实际归还本金600.00仅释放一次；违约金6.00、feeRebate0.00、结清总额606.00，真实账务与占用一致；重复/并发重试不双释放'}:{...item,expected:item.expected.replaceAll('test-profile-v1','test-profile-v2')})
}));
export const fourRequirementScenarioVersions: readonly FourRequirementScenario[] = [...fourRequirementScenarios,...fourRequirementScenariosV2];
export const fourRequirementNodes: Record<FourRequirementNode,{knowledge:Array<{file:keyof FourRequirementScenario['files'];slot:string;reason:string}>;skills:string[];skillSlot:string}> = {
 prepare:{knowledge:[{file:'profile',slot:'business-documents',reason:'本次验证采用的独立试验口径，原始需求不改写'},{file:'requirement',slot:'business-documents',reason:'读取完整原始需求与验收范围'},{file:'rules',slot:'business-documents',reason:'核对需求明确的测试规则'},{file:'questions',slot:'business-documents',reason:'保留待确认与内部差异'},{file:'implementation',slot:'business-documents',reason:'识别真实基线与集成缺口'}],skills:['ba-requirement-analysis','ba-acceptance-criteria','bank-domain-payments'],skillSlot:'business-skills'},
 develop:{knowledge:[{file:'profile',slot:'development-knowledge',reason:'本次验证采用的独立试验口径，原始需求不改写'},{file:'requirement',slot:'development-knowledge',reason:'实现须追溯完整需求'},{file:'implementation',slot:'development-knowledge',reason:'按真实模块、协议与数据约束设计'},{file:'rules',slot:'development-knowledge',reason:'实现业务规则并覆盖边界'},{file:'questions',slot:'development-knowledge',reason:'不擅自决定未确认策略'}],skills:['arch-solution-design','dev-backend-service','dev-api-integration','dev-frontend-ui','dev-unit-test'],skillSlot:'development-skills'},
 verify:{knowledge:[{file:'profile',slot:'verification-knowledge',reason:'本次验证采用的独立试验口径，原始需求不改写'},{file:'requirement',slot:'verification-knowledge',reason:'检查全部需求覆盖'},{file:'acceptance',slot:'verification-knowledge',reason:'按原始场景形成实际测试证据'},{file:'questions',slot:'verification-knowledge',reason:'确认冲突已澄清或阻塞仍明确'}],skills:['dev-bank-coding-standards','dev-code-reviewer','qa-integration-test','sec-scan-review'],skillSlot:'quality-skills'},
 accept:{knowledge:[{file:'profile',slot:'acceptance-knowledge',reason:'本次验证采用的独立试验口径，原始需求不改写'},{file:'requirement',slot:'acceptance-knowledge',reason:'逐项核对原始范围与实际交付'},{file:'acceptance',slot:'acceptance-knowledge',reason:'核对测试报告和问题复验'},{file:'questions',slot:'acceptance-knowledge',reason:'确认未决项及决策依据'}],skills:['qa-uat-support'],skillSlot:'acceptance-skills'},
};
/** An unrelated same-title task cannot acquire a scenario; the exact source fingerprint is required. */
export function fourRequirementScenario(projectId:string,task:{id:string;title:string;description?:string}) {
 if(projectId!=='carddemo'||!/^REQ-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id))return undefined;
 const lines=task.description?.split('\n')??[],versions=lines.filter(line=>line.startsWith('试验口径版本：')),digests=lines.filter(line=>line.startsWith('试验口径 SHA256：'));
 const candidates=versions.length===0&&digests.length===0?fourRequirementScenarios:versions.length===1&&versions[0]==='试验口径版本：test-profile-v2'&&digests.length===1&&digests[0]==='试验口径 SHA256：'+fourRequirementProfileV2Sha256?fourRequirementScenariosV2:[];
 return candidates.find(s=>task.title===s.title&&lines.includes('业务需求编号：'+s.businessId)&&lines.includes('原始需求 SHA256：'+s.sourceSha256));
}
