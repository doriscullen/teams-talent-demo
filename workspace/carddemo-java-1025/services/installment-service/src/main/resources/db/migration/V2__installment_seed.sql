-- 本轮已批准测试口径的参数种子（test-profile-v2；正式定价与上限仍以 PRD §12 待确认）
INSERT INTO installment_policy (id, min_transaction_amount, min_bill_amount, max_active_plans_per_account,
                                penalty_rate, preview_ttl_minutes, idempotency_window_minutes, updated_at)
VALUES (1, 100.00, 500.00, 20, 0.0100, 30, 30, CURRENT_TIMESTAMP);

INSERT INTO installment_rate (term_months, monthly_fee_rate)
VALUES (3, 0.0060),
       (6, 0.0055),
       (12, 0.0050);

-- 后台权限区分：客服可协助写，风控只读（AC-21）；正式 RBAC 仍待 PRD §12-8 确认
INSERT INTO installment_permission (user_id, permission)
VALUES ('ADMIN001', 'STAFF_ASSIST'),
       ('ADMIN002', 'STAFF_ASSIST'),
       ('ADMIN003', 'RISK_READONLY');

-- 持卡人账户归属（真实归属来源；越权读取 404）
INSERT INTO installment_account_access (account_id, user_id)
VALUES ('00000000006', 'USER0001'),
       ('00000000005', 'USER0002');
