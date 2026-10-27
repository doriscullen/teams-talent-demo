package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRepayment;
import com.carddemo.installment.domain.model.SettlementIntent;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.SettlementIntentRepository;
import com.carddemo.installment.domain.service.EffectIds;
import com.carddemo.installment.domain.service.SettlementCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 提前结清（REQ-INS-06 / BR-INS-12/14）：
 * <ol>
 *   <li>同 settlementKey 重放 → 200 返回首次结果，不重复扣款/分录/释放；</li>
 *   <li>不同新 key 对非 ACTIVE 计划 → 409 SETTLEMENT_NOT_ALLOWED；</li>
 *   <li>计划行锁 + 单计划在途意图唯一约束：同键或异键并发只产生一次资金效果；</li>
 *   <li>ledger 过账与真实还款都用稳定作用ID（settlementKey / SETTLE-settlementKey），
 *       任一步骤响应丢失都可在同键重试中安全续跑；</li>
 *   <li>手续费减免本轮由服务端固定为 0.00（A-005），客户/客服传入非零减免一律 400。</li>
 * </ol>
 */
@Service
public class SettlementService {

    private static final String CASH = "1001-CASH-COLLECTION";
    private static final String RECEIVABLE = "1100-INSTALLMENT-RECEIVABLE";
    private static final String PENALTY_INCOME = "4002-SETTLEMENT-PENALTY-INCOME";
    private static final String REVERSAL_SUFFIX = "-REV";
    /** 在途结清状态（FAILED/COMPLETED 不占在途，A-R005）。 */
    private static final List<String> IN_FLIGHT_SETTLEMENT_STATUSES = List.of(SettlementIntent.PENDING,
            SettlementIntent.LEDGER_POSTED, SettlementIntent.PAYMENT_APPLIED);

    public record SettlementCommand(String planId, String settlementKey, BigDecimal feeRebate) {
    }

    public record SettlementResult(InstallmentPlan plan, SettlementCalculator.SettlementQuote quote,
                                   boolean replayed) {
    }

    private final InstallmentPlanRepository planRepository;
    private final InstallmentPolicyRepository policyRepository;
    private final SettlementIntentRepository intentRepository;
    private final InstallmentRepaymentRepository repaymentRepository;
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
                             InstallmentRepaymentRepository repaymentRepository,
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
        this.repaymentRepository = repaymentRepository;
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
        requireServerSideRebate(command.feeRebate());

        SettlementIntent existing = intentRepository.findById(command.settlementKey()).orElse(null);
        if (existing != null) {
            if (!existing.getPlanId().equals(command.planId())) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                        "Settlement key is already used by another plan.");
            }
            return resumeOrReplay(principal, existing);
        }

        SettlementIntent intent = transactionTemplate.execute(status -> {
            InstallmentPlan locked = planRepository.findForUpdate(command.planId())
                    .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
            if (!locked.isActive()) {
                throw new BusinessRuleException("SETTLEMENT_NOT_ALLOWED", "Only ACTIVE plans can be settled.");
            }
            SettlementIntent inflight = intentRepository
                    .findFirstByPlanIdAndStatusIn(command.planId(), IN_FLIGHT_SETTLEMENT_STATUSES)
                    .orElse(null);
            if (inflight != null && !inflight.getSettlementKey().equals(command.settlementKey())) {
                throw new BusinessRuleException("CONCURRENT_SETTLEMENT",
                        "Another settlement is in progress for this plan.");
            }
            requireNoRepaymentInFlight(command.planId());
            SettlementIntent again = intentRepository.findById(command.settlementKey()).orElse(null);
            if (again != null) {
                return again;
            }
            SettlementCalculator.SettlementQuote quote = calculator.quote(locked.getRemainingPrincipal(),
                    BigDecimal.ZERO.setScale(2), policy.getPenaltyRate());
            return intentRepository.saveAndFlush(new SettlementIntent(command.settlementKey(),
                    command.planId(), quote.remainingPrincipal(), quote.penaltyFee(), quote.feeRebate(),
                    quote.settlementTotal(), clock.now()));
        });
        if (intent == null) {
            throw new IllegalStateException("settlement intent was not persisted");
        }
        return resumeOrReplay(principal, intent);
    }

    /** 结清试算（原文 4.2.05）：只读，不产生资金状态，供前端展示金额组成后再确认。 */
    public SettlementCalculator.SettlementQuote quote(InstallmentPrincipal principal, String planId) {
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new BusinessRuleException("CONFIGURATION_MISSING", "Installment policy is missing"));
        InstallmentPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        accessGuard.requireWriteAccess(principal, plan.getAccountId());
        if (!plan.isActive()) {
            throw new BusinessRuleException("SETTLEMENT_NOT_ALLOWED", "Only ACTIVE plans can be settled.");
        }
        return calculator.quote(plan.getRemainingPrincipal(), BigDecimal.ZERO.setScale(2),
                policy.getPenaltyRate());
    }

    private SettlementResult resumeOrReplay(InstallmentPrincipal principal, SettlementIntent intent) {
        SettlementCalculator.SettlementQuote quote = quoteOf(intent);
        if (intent.isFailed()) {
            throw new BusinessRuleException("SETTLEMENT_FAILED",
                    "A previous settlement attempt was rejected and reversed; please use a new settlement key.");
        }
        if (intent.isCompleted()) {
            InstallmentPlan plan = planRepository.findById(intent.getPlanId())
                    .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
            return new SettlementResult(plan, quote, true);
        }

        try {
            // ① 会计过账（按 settlementKey 幂等，冲正/重复都只保留一组）
            ledgerPort.postGroup(intent.getSettlementKey(), "INSTALLMENT_SETTLEMENT", intent.getPlanId(),
                    settlementLines(quote));
            markLedgerPosted(intent);

            // ② 真实还款（effectId = SETTLE-<key>，账户端去重，响应丢失重试不会二次扣款）
            accountPort.applyRepayment(planAccountId(intent.getPlanId()), quote.remainingPrincipal(),
                    EffectIds.settlement(intent.getPlanId(), intent.getSettlementKey()));
            markPaymentApplied(intent);

            // ③ 状态落库：计划 SETTLED + 意图 COMPLETED
            SettlementCalculator.SettlementQuote finalQuote = quote;
            InstallmentPlan settled = transactionTemplate.execute(status -> complete(intent));
            auditPort.record(principal.userId(), "INSTALLMENT_SETTLED", "INSTALLMENT_PLAN", intent.getPlanId(),
                    "remaining=" + finalQuote.remainingPrincipal() + ",penalty=" + finalQuote.penaltyFee()
                            + ",rebate=" + finalQuote.feeRebate() + ",total=" + finalQuote.settlementTotal());
            notificationPort.enqueue("SMS", settled.getAccountId(), "INSTALLMENT_SETTLED",
                    "planId=" + settled.getPlanId() + ";total=" + finalQuote.settlementTotal());
            return new SettlementResult(settled, finalQuote, false);
        } catch (BusinessRuleException | NotFoundException ex) {
            // 账户端业务拒绝（余额不足等）：冲正本次结清分录；冲正成功才置 FAILED（重试需新键）
            if (reverseLedger(intent, quote)) {
                markFailed(intent, ex.getMessage());
            }
            throw ex;
        } catch (RemoteServiceException ex) {
            recordError(intent, ex.getMessage());
            throw ex;
        }
    }

    /** 结清冲正（A-001 对账补偿边界）：与结清分录方向相反且金额相等，保证无未冲正的孤立入账。 */
    private boolean reverseLedger(SettlementIntent intent, SettlementCalculator.SettlementQuote quote) {
        List<LedgerPort.JournalLine> lines = new ArrayList<>(3);
        lines.add(new LedgerPort.JournalLine(CASH, "CREDIT", quote.settlementTotal(),
                "reversal: settlement cash"));
        lines.add(new LedgerPort.JournalLine(RECEIVABLE, "DEBIT", quote.remainingPrincipal(),
                "reversal: settlement principal"));
        if (quote.penaltyFee().signum() > 0) {
            lines.add(new LedgerPort.JournalLine(PENALTY_INCOME, "DEBIT", quote.penaltyFee(),
                    "reversal: settlement penalty"));
        }
        try {
            ledgerPort.postGroup(intent.getSettlementKey() + REVERSAL_SUFFIX, "INSTALLMENT_SETTLEMENT_REVERSAL",
                    intent.getPlanId(), lines);
            return true;
        } catch (RemoteServiceException ex) {
            // 冲正也失败时保留在途状态，由运维对账处理；至少不把结清标成完成或允许新键
            recordError(intent, "reversal failed: " + ex.getMessage());
            return false;
        }
    }

    private InstallmentPlan complete(SettlementIntent detached) {
        SettlementIntent intent = intentRepository.findById(detached.getSettlementKey())
                .orElseThrow(() -> new IllegalStateException("settlement intent disappeared"));
        InstallmentPlan locked = planRepository.findForUpdate(intent.getPlanId())
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        if (locked.isActive()) {
            locked.settle(intent.getSettlementKey(), clock.now());
            planRepository.saveAndFlush(locked);
        } else if (!intent.getSettlementKey().equals(locked.getSettlementIdempotencyKey())) {
            throw new BusinessRuleException("CONCURRENT_MODIFICATION",
                    "Plan was settled by another request, please refresh.");
        }
        intent.markCompleted(clock.now());
        intentRepository.saveAndFlush(intent);
        return locked;
    }

    private List<LedgerPort.JournalLine> settlementLines(SettlementCalculator.SettlementQuote quote) {
        List<LedgerPort.JournalLine> lines = new ArrayList<>(4);
        lines.add(new LedgerPort.JournalLine(CASH, "DEBIT", quote.settlementTotal(), "settlement cash received"));
        lines.add(new LedgerPort.JournalLine(RECEIVABLE, "CREDIT", quote.remainingPrincipal(),
                "settlement principal"));
        if (quote.penaltyFee().signum() > 0) {
            lines.add(new LedgerPort.JournalLine(PENALTY_INCOME, "CREDIT", quote.penaltyFee(),
                    "settlement penalty"));
        }
        return lines;
    }

    /** A-R003：账户可能已扣但尚未回写的还款（PENDING）必须先恢复，不能按旧 remaining 再结清。 */
    private void requireNoRepaymentInFlight(String planId) {
        if (repaymentRepository.existsByPlanIdAndStatus(planId, InstallmentRepayment.PENDING)) {
            throw new BusinessRuleException("REPAYMENT_IN_PROGRESS",
                    "A repayment is still in progress for this plan; resume it before settling.");
        }
    }

    private void requireServerSideRebate(BigDecimal feeRebate) {
        if (feeRebate != null && feeRebate.signum() != 0) {
            throw new BusinessRuleException("INVALID_FEE_REBATE",
                    "Fee rebate is fixed at 0.00 for this release and cannot be supplied by the caller.");
        }
    }

    private SettlementCalculator.SettlementQuote quoteOf(SettlementIntent intent) {
        return new SettlementCalculator.SettlementQuote(intent.getPrincipal(), intent.getPenaltyFee(),
                intent.getFeeRebate(), intent.getAmount());
    }

    private String planAccountId(String planId) {
        return planRepository.findById(planId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."))
                .getAccountId();
    }

    private void markLedgerPosted(SettlementIntent intent) {
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getSettlementKey()).ifPresent(fresh -> {
                    fresh.markLedgerPosted(clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
    }

    private void markPaymentApplied(SettlementIntent intent) {
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getSettlementKey()).ifPresent(fresh -> {
                    fresh.markPaymentApplied(clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
    }

    private void recordError(SettlementIntent intent, String message) {
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getSettlementKey()).ifPresent(fresh -> {
                    fresh.recordError(message, clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
    }

    private void markFailed(SettlementIntent intent, String message) {
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getSettlementKey()).ifPresent(fresh -> {
                    fresh.markFailed(message, clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
    }
}
