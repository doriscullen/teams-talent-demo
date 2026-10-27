-- A-001：结清意图的「在途」判定排除已冲正/失败意图，失败键不允许复用但新键可重新发起
DROP INDEX IF EXISTS uk_installment_settlement_active_plan;

CREATE UNIQUE INDEX uk_installment_settlement_active_plan
    ON installment_settlement_intent (plan_id)
    WHERE status NOT IN ('COMPLETED', 'FAILED');
