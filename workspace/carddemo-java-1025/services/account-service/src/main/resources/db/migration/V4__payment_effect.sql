-- A-001：账户端还款效果去重（调用方稳定 effectId → 只扣减一次）
CREATE TABLE account_payment_effect (
    effect_id      VARCHAR(64)    PRIMARY KEY,
    account_id     VARCHAR(11)    NOT NULL,
    amount         NUMERIC(12, 2) NOT NULL,
    balance_after  NUMERIC(12, 2),
    created_at     TIMESTAMP      NOT NULL
);

CREATE INDEX idx_account_payment_effect_account ON account_payment_effect (account_id);
