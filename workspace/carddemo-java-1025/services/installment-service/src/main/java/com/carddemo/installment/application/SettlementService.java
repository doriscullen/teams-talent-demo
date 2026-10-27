package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.SettlementIntent;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.SettlementIntentRepository;
import com.carddemo.installment.domain.service.SettlementCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;

/**
 * 提前结清（REQ-INS-06 / BR-INS-12/14）：
 * <ol>
 *   <li>同 settlementKey 重放 → 200 返回首次结果，不重复扣款/分录/释放；</li>
 *   <li>不同新 key 对非 ACTIVE 计划 → 409 SETTLEMENT_NOT_ALLOWED；</li>
 *   <li>ledger 过账失败 → 503 且计划保持 ACTIVE、不释放额度；</li>
 *   <li>本金已在 current_balance，结清只做一次真实还款，不额外释放授权额度（BR-INS-10）。</li>
 * </ol>
 * 步骤用独立事务落盘意图，保证跨服务步骤失败后可凭同一 key 继续而不重复计账。
 */
@Service
public class SettlementService {

    public record SettlementCommand(String planId, String settlementKey, BigDecimal feeRebate) {
    }

    public record SettlementResult(InstallmentPlan plan, SettlementCalculator.SettlementQuote quote,
                                   boolean replayed) {
    }

    private final InstallmentPlanRepository planRepository;
    private final InstallmentPolicyRepository policyRepository;
    private final SettlementIntentRepository intentRepository;
    private final SettlementCalculator calculator;
    private final LedgerPort ledgerPort;
    private final AccountPort accountPort;
    private final AuditPort auditPort;
    private final NotificationPort notificationPort;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;

    public SettlementService(InstallmentPlanRepository planRepository,
                             InstallmentPolicyRepository policyRepository,
                             SettlementIntentRepository intentRepository,
                             SettlementCalculator calculator,
                             LedgerPort ledgerPort,
                             AccountPort accountPort,
                             AuditPort auditPort,
                             NotificationPort notificationPort,
                             AccessGuard accessGuard,
                             ClockProvider clock,
                             PlatformTransactionManager transactionManager) {
        this.planRepository = planRepository;
        this.policyRepository = policyRepository;
        this.intentRepository = intentRepository;
        this.calculator = calculator;
        this.ledgerPort = ledgerPort;
        this.accountPort = accountPort;
        this.auditPort = auditPort;
        this.notificationPort = notificationPort;
        this.accessGuard = accessGuard;
        this.clock = clock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public SettlementResult settle(InstallmentPrincipal principal, SettlementCommand command) {
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new BusinessRuleException("CONFIGURATION_MISSING", "Installment policy is missing"));
        InstallmentPlan plan = planRepository.findById(command.planId())
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        accessGuard.requireWriteAccess(principal, plan.getAccountId());

        SettlementIntent existing = intentRepository.findById(command.settlementKey()).orElse(null);
        if (existing != null && !existing.getPlanId().equals(command.planId())) {
            throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                    "Settlement key is already used by another plan.");
        }
        if (existing != null && existing.isCompleted()) {
            SettlementCalculator.SettlementQuote quote = new SettlementCalculator.SettlementQuote(
                    existing.getPrincipal(), existing.getPenaltyFee(), existing.getFeeRebate(), existing.getAmount());
            return new SettlementResult(plan, quote, true);
        }
        if (!plan.isActive()) {
            throw new BusinessRuleException("SETTLEMENT_NOT_ALLOWED", "Only ACTIVE plans can be settled.");
        }

        SettlementCalculator.SettlementQuote quote = calculator.quote(
                plan.getRemainingPrincipal(), command.feeRebate(), policy.getPenaltyRate());

        SettlementIntent intent = existing != null ? existing
                : transactionTemplate.execute(status -> intentRepository.saveAndFlush(
                        new SettlementIntent(command.settlementKey(), command.planId(),
                                quote.remainingPrincipal(), quote.penaltyFee(), quote.feeRebate(),
                                quote.settlementTotal(), clock.now())));

        // ① 会计过账（按 settlementKey 幂等）
        ledgerPort.postGroup(command.settlementKey(), "INSTALLMENT_SETTLEMENT", plan.getPlanId(), List.of(
                new LedgerPort.JournalLine("1100-INSTALLMENT-RECEIVABLE", "CREDIT", quote.remainingPrincipal(),
                        "settlement principal"),
                new LedgerPort.JournalLine("4002-SETTLEMENT-PENALTY-INCOME", "CREDIT", quote.penaltyFee(),
                        "settlement penalty"),
                new LedgerPort.JournalLine("4003-SETTLEMENT-FEE-REBATE", "DEBIT", quote.feeRebate(),
                        "settlement fee rebate")));
        intent.markLedgerPosted(clock.now());
        transactionTemplate.execute(status -> intentRepository.saveAndFlush(intent));

        // ② 真实还款（只归还剩余本金一次）
        accountPort.applyRepayment(plan.getAccountId(), quote.remainingPrincipal());

        // ③ 状态落库：计划 SETTLED + 意图 COMPLETED（乐观锁冲突返回 409 CONCURRENT_MODIFICATION）
        try {
            SettlementCalculator.SettlementQuote finalQuote = quote;
            transactionTemplate.execute(status -> {
                InstallmentPlan loaded = planRepository.findById(command.planId()).orElseThrow();
                loaded.settle(command.settlementKey(), clock.now());
                planRepository.saveAndFlush(loaded);
                intent.markCompleted(clock.now());
                intentRepository.saveAndFlush(intent);
                return finalQuote;
            });
        } catch (ObjectOptimisticLockingFailureException ex) {
            throw new BusinessRuleException("CONCURRENT_MODIFICATION",
                    "Plan state changed concurrently, please refresh and retry.");
        }

        auditPort.record(principal.userId(), "INSTALLMENT_SETTLED", "INSTALLMENT_PLAN", plan.getPlanId(),
                "remaining=" + quote.remainingPrincipal() + ",penalty=" + quote.penaltyFee()
                        + ",rebate=" + quote.feeRebate() + ",total=" + quote.settlementTotal());
        notificationPort.enqueue("SMS", plan.getAccountId(), "INSTALLMENT_SETTLED",
                "planId=" + plan.getPlanId() + ";total=" + quote.settlementTotal());
        InstallmentPlan settled = planRepository.findById(command.planId()).orElse(plan);
        return new SettlementResult(settled, quote, false);
    }
}
