-- 本轮返工（A-R002 部分本金还款 / A-R001 补偿阶段）
-- 1) 还款计划按实际归还本金累计（本金-only 部分还款，不引入手续费分配政策）
ALTER TABLE installment_schedule ADD COLUMN paid_principal NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- 已有 PAID 期次视为已足额归还
UPDATE installment_schedule SET paid_principal = principal_due WHERE status = 'PAID';

-- 2) 创建意图增加「补偿中」阶段索引（恢复只允许完成逆向）
CREATE INDEX idx_installment_intent_status ON installment_application_intent (status, updated_at);
