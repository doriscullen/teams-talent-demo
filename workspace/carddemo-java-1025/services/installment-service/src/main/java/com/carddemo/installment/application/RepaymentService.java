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
import com.carddemo.installment.domain.model.InstallmentRepayment;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.ScheduleStatus;
import com.carddemo.installment.domain.model.SettlementIntent;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.domain.repository.SettlementIntentRepository;
import com.carddemo.installment.domain.service.EffectIds;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;

/**
 * 一期还款（A-003 / US-005，本轮按 A-R002/A-R003/A-R004 收紧）：
 * <ol>
 *   <li>金额合同：本轮只支持「完整一期本金」还款；任何其它金额在任何远端资金动作之前拒绝（400）；
 *       每一分都精确回写到 remaining 与还款计划行，不存在扣款与回写不一致；</li>
 *   <li>同一计划的本金资金动作（还款/结清）共用互斥：计划锁内检查在途结清意图，
 *       未完成还款（PENDING，账户可能已扣）也会阻止结清，避免按旧 remaining 重复付款；</li>
 *   <li>账户作用ID由服务端按「操作类型+计划+客户端键」生成（{@link EffectIds}），
 *       与结清命名空间分离，跨操作不会碰撞；</li>
 *   <li>同 paymentKey 重放返回首次结果；账户/账务失败保持可续跑，对账可继续完成。</li>
 * </ol>
 */
@Service
public class RepaymentService {

    private static final Logger log = LoggerFactory.getLogger(RepaymentService.class);

    private static final String CASH = "1001-CASH-COLLECTION";
    private static final String RECEIVABLE = "1100-INSTALLMENT-RECEIVABLE";
    private static final List<String> SETTLEMENT_IN_FLIGHT = List.of(SettlementIntent.PENDING,
            SettlementIntent.LEDGER_POSTED, SettlementIntent.PAYMENT_APPLIED);

    public record RepaymentCommand(String planId, String paymentKey, BigDecimal amount) {
    }

    public record RepaymentResult(InstallmentPlan plan, BigDecimal principalApplied, int paidInstallments,
                                  boolean replayed) {
    }

    private final InstallmentPlanRepository planRepository;
    private final InstallmentScheduleRepository scheduleRepository;
    private final InstallmentRepaymentRepository repaymentRepository;
    private final SettlementIntentRepository settlementIntentRepository;
    private final AccountPort accountPort;
    private final LedgerPort ledgerPort;
    private final AuditPort auditPort;
    private final NotificationPort notificationPort;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;

    public RepaymentService(InstallmentPlanRepository planRepository,
                            InstallmentScheduleRepository scheduleRepository,
                            InstallmentRepaymentRepository repaymentRepository,
                            SettlementIntentRepository settlementIntentRepository,
                            AccountPort accountPort,
                            LedgerPort ledgerPort,
                            AuditPort auditPort,
                            NotificationPort notificationPort,
                            AccessGuard accessGuard,
                            ClockProvider clock,
                            PlatformTransactionManager transactionManager) {
        this.planRepository = planRepository;
        this.scheduleRepository = scheduleRepository;
        this.repaymentRepository = repaymentRepository;
        this.settlementIntentRepository = settlementIntentRepository;
        this.accountPort = accountPort;
        this.ledgerPort = ledgerPort;
        this.auditPort = auditPort;
        this.notificationPort = notificationPort;
        this.accessGuard = accessGuard;
        this.clock = clock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public RepaymentResult repay(InstallmentPrincipal principal, RepaymentCommand command) {
        InstallmentPlan plan = planRepository.findById(command.planId())
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        accessGuard.requireWriteAccess(principal, plan.getAccountId());

        InstallmentRepayment existing = repaymentRepository.findById(command.paymentKey()).orElse(null);
        if (existing != null) {
            if (!existing.getPlanId().equals(command.planId())
                    || existing.getAmount().compareTo(command.amount()) != 0) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                        "paymentKey is already used by a different repayment.");
            }
            if (existing.isCompleted()) {
                return replay(command.planId(), existing);
            }
        }

        final InstallmentRepayment repayment;
        if (existing != null) {
            repayment = existing;
        } else {
            // 计划锁内：状态/在途结清/金额合同/并发同键重核（A-R002/A-R003）
            InstallmentRepayment created = transactionTemplate.execute(status -> {
                InstallmentPlan locked = planRepository.findForUpdate(command.planId())
                        .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND",
                                "Installment plan not found."));
                InstallmentRepayment concurrent = repaymentRepository.findById(command.paymentKey()).orElse(null);
                if (concurrent != null) {
                    if (!concurrent.getPlanId().equals(command.planId())
                            || concurrent.getAmount().compareTo(command.amount()) != 0) {
                        throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                                "paymentKey is already used by a different repayment.");
                    }
                    if (!concurrent.isCompleted() && !InstallmentRepayment.PENDING.equals(concurrent.getStatus())) {
                        throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                                "A previous repayment attempt with this key failed; please retry it explicitly.");
                    }
                }
                if (concurrent == null) {
                    requireActive(locked);
                    requireSupportedAmount(locked, command.amount());
                    requireNoSettlementInFlight(locked.getPlanId());
                }
                return concurrent != null ? concurrent
                        : repaymentRepository.saveAndFlush(new InstallmentRepayment(command.paymentKey(),
                        command.planId(), command.amount(), clock.now()));
            });
            if (created == null) {
                throw new IllegalStateException("repayment intent was not persisted");
            }
            if (created.isCompleted()) {
                return replay(command.planId(), created);
            }
            repayment = created;
        }

        String effectId = EffectIds.repayment(command.planId(), command.paymentKey());
        try {
            accountPort.applyRepayment(plan.getAccountId(), command.amount(), effectId);
            ledgerPort.postGroup("REPAY-" + effectId, "INSTALLMENT_REPAYMENT", command.planId(),
                    List.of(new LedgerPort.JournalLine(CASH, "DEBIT", command.amount(), "installment repayment"),
                            new LedgerPort.JournalLine(RECEIVABLE, "CREDIT", command.amount(),
                                    "installment principal repaid")));
        } catch (BusinessRuleException ex) {
            markFailed(repayment, ex.getMessage());
            throw ex;
        } catch (RemoteServiceException ex) {
            recordError(repayment, ex.getMessage());
            throw ex;
        }

        RepaymentResult result = transactionTemplate.execute(status -> applyToPlan(repayment));
        auditPort.record(principal.userId(), "INSTALLMENT_REPAID", "INSTALLMENT_PLAN", command.planId(),
                "paymentKey=" + command.paymentKey() + ",amount=" + command.amount());
        notificationPort.enqueue("SMS", plan.getAccountId(), "INSTALLMENT_REPAID",
                "planId=" + command.planId() + ";amount=" + command.amount());
        return result;
    }

    /** 对账补偿（A-R003）：续跑账户可能已扣但尚未回写的还款（PENDING）。 */
    public int reconcilePending() {
        List<InstallmentRepayment> stale = repaymentRepository.findByStatusInAndUpdatedAtBefore(
                List.of(InstallmentRepayment.PENDING), clock.now().minusSeconds(5));
        int completed = 0;
        for (InstallmentRepayment repayment : stale) {
            try {
                InstallmentPlan plan = planRepository.findById(repayment.getPlanId()).orElse(null);
                if (plan == null) {
                    continue;
                }
                String effectId = EffectIds.repayment(repayment.getPlanId(), repayment.getPaymentKey());
                accountPort.applyRepayment(plan.getAccountId(), repayment.getAmount(), effectId);
                ledgerPort.postGroup("REPAY-" + effectId, "INSTALLMENT_REPAYMENT", repayment.getPlanId(),
                        List.of(new LedgerPort.JournalLine(CASH, "DEBIT", repayment.getAmount(),
                                        "installment repayment"),
                                new LedgerPort.JournalLine(RECEIVABLE, "CREDIT", repayment.getAmount(),
                                        "installment principal repaid")));
                transactionTemplate.execute(status -> applyToPlan(repayment));
                completed++;
            } catch (RuntimeException ex) {
                log.warn("repayment reconciliation failed: paymentKey={} error={}",
                        repayment.getPaymentKey(), ex.getMessage());
                recordError(repayment, ex.getMessage());
            }
        }
        return completed;
    }

    private RepaymentResult applyToPlan(InstallmentRepayment detached) {
        InstallmentRepayment repayment = repaymentRepository.findById(detached.getPaymentKey())
                .orElseThrow(() -> new IllegalStateException("repayment intent disappeared"));
        if (repayment.isCompleted()) {
            InstallmentPlan plan = planRepository.findById(repayment.getPlanId()).orElseThrow();
            return new RepaymentResult(plan, repayment.getPrincipalApplied(), 0, true);
        }
        InstallmentPlan locked = planRepository.findForUpdate(repayment.getPlanId())
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        requireActive(locked);

        InstallmentSchedule target = nextUnpaidSchedule(locked.getPlanId());
        if (target == null || repayment.getAmount().compareTo(target.getPrincipalDue()) != 0) {
            // 金额合同在锁内被破坏（计划已变化）→ 显式失败，不静默吞款
            throw new BusinessRuleException("REPAYMENT_AMOUNT_CHANGED",
                    "The plan schedule changed; please retry with the current period amount.");
        }
        target.markPaid(clock.now());
        scheduleRepository.save(target);
        locked.repayPrincipal(repayment.getAmount());
        planRepository.saveAndFlush(locked);
        repayment.markCompleted(repayment.getAmount(), clock.now());
        repaymentRepository.saveAndFlush(repayment);
        return new RepaymentResult(locked, repayment.getAmount(), 1, false);
    }

    private void requireSupportedAmount(InstallmentPlan plan, BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new BusinessRuleException("INVALID_PARAMETER", "Repayment amount must be greater than zero.");
        }
        if (amount.stripTrailingZeros().scale() > 2) {
            throw new BusinessRuleException("INVALID_PARAMETER", "Repayment amount supports 2 decimal places.");
        }
        if (amount.compareTo(plan.getRemainingPrincipal()) > 0) {
            throw new BusinessRuleException("REPAYMENT_EXCEEDS_PRINCIPAL",
                    "Repayment amount exceeds the remaining principal.");
        }
        InstallmentSchedule next = nextUnpaidSchedule(plan.getPlanId());
        if (next == null) {
            throw new BusinessRuleException("REPAYMENT_NOT_ALLOWED", "There is no unpaid period to repay.");
        }
        if (amount.compareTo(next.getPrincipalDue()) != 0) {
            // A-R002：本轮只支持完整期次本金；在任何远端资金动作前拒绝不支持的金额
            throw new BusinessRuleException("UNSUPPORTED_REPAYMENT_AMOUNT",
                    "Only a full period principal of " + next.getPrincipalDue().toPlainString()
                            + " can be repaid at a time.");
        }
    }

    private InstallmentSchedule nextUnpaidSchedule(String planId) {
        for (InstallmentSchedule schedule : scheduleRepository.findByPlanIdOrderByInstallmentNo(planId)) {
            if (schedule.getStatus() != ScheduleStatus.PAID) {
                return schedule;
            }
        }
        return null;
    }

    private void requireNoSettlementInFlight(String planId) {
        settlementIntentRepository.findFirstByPlanIdAndStatusIn(planId, SETTLEMENT_IN_FLIGHT)
                .ifPresent(intent -> {
                    throw new BusinessRuleException("SETTLEMENT_IN_PROGRESS",
                            "A settlement is in progress for this plan; retry that settlement instead.");
                });
    }

    private RepaymentResult replay(String planId, InstallmentRepayment repayment) {
        InstallmentPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        return new RepaymentResult(plan, repayment.getPrincipalApplied(), 0, true);
    }

    private static void requireActive(InstallmentPlan plan) {
        if (!plan.isActive()) {
            throw new BusinessRuleException("REPAYMENT_NOT_ALLOWED", "Only ACTIVE plans accept repayments.");
        }
    }

    private void recordError(InstallmentRepayment repayment, String message) {
        transactionTemplate.executeWithoutResult(status ->
                repaymentRepository.findById(repayment.getPaymentKey()).ifPresent(fresh -> {
                    fresh.recordError(message, clock.now());
                    repaymentRepository.saveAndFlush(fresh);
                }));
    }

    private void markFailed(InstallmentRepayment repayment, String message) {
        transactionTemplate.executeWithoutResult(status ->
                repaymentRepository.findById(repayment.getPaymentKey()).ifPresent(fresh -> {
                    fresh.markFailed(message, clock.now());
                    repaymentRepository.saveAndFlush(fresh);
                }));
    }
}
