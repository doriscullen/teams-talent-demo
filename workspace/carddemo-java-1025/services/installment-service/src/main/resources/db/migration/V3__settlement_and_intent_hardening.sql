-- 本轮返工迁移（A-001/A-002/A-003/C-03）：
-- 1) 列类型与 JPA 实体对齐（installment-service 曾因 Schema-validation 无法启动）；
-- 2) 新增创建意图、真实还款、通知投递可观测字段与结清在途唯一约束。

-- 修复：SMALLINT ↔ int 漂移（V1 建表时未与实体对齐）
ALTER TABLE installment_plan ALTER COLUMN term_months TYPE INT;
ALTER TABLE installment_schedule ALTER COLUMN installment_no TYPE INT;

-- 创建意图（A-002）：ledger 过账与本地建计划共用同一稳定作用单元；
-- 步骤失败后凭同一 intent/planId 续跑，不产生第二组有效分录。
CREATE TABLE installment_application_intent (
    intent_id         VARCHAR(32)    PRIMARY KEY,
    idempotency_key   VARCHAR(64)    NOT NULL UNIQUE,
    account_id        VARCHAR(11)    NOT NULL,
    source_type       VARCHAR(16)    NOT NULL,
    source_id         VARCHAR(32)    NOT NULL,
    principal         NUMERIC(12, 2) NOT NULL,
    term_months       INT            NOT NULL,
    monthly_fee_rate  NUMERIC(6, 4)  NOT NULL,
    total_fee         NUMERIC(12, 2) NOT NULL,
    plan_id           VARCHAR(32)    NOT NULL,
    status            VARCHAR(24)    NOT NULL,
    last_error        VARCHAR(200),
    created_at        TIMESTAMP      NOT NULL,
    updated_at        TIMESTAMP      NOT NULL
);

CREATE UNIQUE INDEX uk_installment_intent_plan ON installment_application_intent (plan_id);

-- 真实一期还款（A-003）：payment_key 幂等，还款动作先经 account-service 真实扣减再回写计划。
CREATE TABLE installment_repayment (
    payment_key       VARCHAR(64)    PRIMARY KEY,
    plan_id           VARCHAR(32)    NOT NULL REFERENCES installment_plan (plan_id),
    amount            NUMERIC(12, 2) NOT NULL,
    principal_applied NUMERIC(12, 2) NOT NULL,
    status            VARCHAR(24)    NOT NULL,
    last_error        VARCHAR(200),
    created_at        TIMESTAMP      NOT NULL,
    updated_at        TIMESTAMP      NOT NULL
);

CREATE INDEX idx_installment_repayment_plan ON installment_repayment (plan_id);

-- A-001：同一计划的结清只允许一条在途意图（异键并发不会各付一次）。
CREATE UNIQUE INDEX uk_installment_settlement_active_plan
    ON installment_settlement_intent (plan_id)
    WHERE status <> 'COMPLETED';

ALTER TABLE installment_settlement_intent ADD COLUMN last_error VARCHAR(200);

-- C-03：通知投递可观测（真实投递时间 / 最近更新），失败可补发。
ALTER TABLE installment_notification_outbox ADD COLUMN sent_at TIMESTAMP;
ALTER TABLE installment_notification_outbox ADD COLUMN updated_at TIMESTAMP;
