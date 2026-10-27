-- 原文 §8.1 / US-004 / §11.2：账户额度视图新增「分期占用」。
-- 口径（BR-INS-10）：installment_occupied = 生效（ACTIVE）计划 remaining_principal 合计，
-- 只含本金，不含手续费与违约金；结清/冲正后计划不再是 ACTIVE，占用自然回落，不做二次扣减。
CREATE VIEW account_limit_view AS
SELECT plan.account_id                              AS account_id,
       SUM(plan.remaining_principal)::numeric(12, 2) AS installment_occupied,
       COUNT(*)                                     AS active_plan_count
FROM installment_plan plan
WHERE plan.status = 'ACTIVE'
GROUP BY plan.account_id;
