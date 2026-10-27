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
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;

/**
 * 一期还款（A-003 / US-005）：真实还款入口，把已实际归还的本金回写到计划与还款计划行。
 * <ol>
 *   <li>先落还款意图（paymentKey 幂等），再经 account-service 真实扣减欠款（effectId = paymentKey）；</li>
 *   <li>在同一本地事务内减少 remainingPrincipal、把最早未还期次置 PAID，并记录已还本金；</li>
 *   <li>同 paymentKey 重放返回首次结果，不二次扣款、不二次回写；</li>
 *   <li>分录按 paymentKey 幂等：DEBIT 现金 / CREDIT 分期应收，借贷平衡。</li>
 * </ol>
 */
@Service
public class RepaymentService {

    private static final String CASH = "1001-CASH-COLLECTION";
    private static final String RECEIVABLE = "1100-INSTALLMENT-RECEIVABLE";

    public record RepaymentCommand(String planId, String paymentKey, BigDecimal amount) {
    }

    public record RepaymentResult(InstallmentPlan plan, BigDecimal principalApplied, int paidInstallments,
                                  boolean replayed) {
    }

    private final InstallmentPlanRepository planRepository;
    private final InstallmentScheduleRepository scheduleRepository;
    private final InstallmentRepaymentRepository repaymentRepository;
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
        requireValidAmount(command.amount());

        InstallmentRepayment existing = repaymentRepository.findById(command.paymentKey()).orElse(null);
        final InstallmentRepayment repayment;
        if (existing != null) {
            repayment = existing;
            if (!repayment.getPlanId().equals(command.planId())
                    || repayment.getAmount().compareTo(command.amount()) != 0) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                        "paymentKey is already used by a different repayment.");
            }
            if (repayment.isCompleted()) {
                return replay(command.planId(), repayment);
            }
        } else {
            InstallmentRepayment created = transactionTemplate.execute(status -> {
                InstallmentPlan locked = planRepository.findForUpdate(command.planId())
                        .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND",
                                "Installment plan not found."));
                requireActive(locked);
                if (command.amount().compareTo(locked.getRemainingPrincipal()) > 0) {
                    throw new BusinessRuleException("REPAYMENT_EXCEEDS_PRINCIPAL",
                            "Repayment amount exceeds the remaining principal.");
                }
                return repaymentRepository.saveAndFlush(new InstallmentRepayment(command.paymentKey(),
                        command.planId(), command.amount(), clock.now()));
            });
            if (created == null) {
                throw new IllegalStateException("repayment intent was not persisted");
            }
            repayment = created;
        }

        try {
            accountPort.applyRepayment(plan.getAccountId(), command.amount(), command.paymentKey());
            ledgerPort.postGroup("REPAY-" + command.paymentKey(), "INSTALLMENT_REPAYMENT", command.planId(),
                    List.of(new LedgerPort.JournalLine(CASH, "DEBIT", command.amount(), "installment repayment"),
                            new LedgerPort.JournalLine(RECEIVABLE, "CREDIT", command.amount(),
                                    "installment principal repaid")));
        } catch (RemoteServiceException ex) {
            recordError(command.paymentKey(), ex.getMessage());
            throw ex;
        }

        RepaymentResult result = transactionTemplate.execute(status -> applyToPlan(principal, repayment));
        auditPort.record(principal.userId(), "INSTALLMENT_REPAID", "INSTALLMENT_PLAN", command.planId(),
                "paymentKey=" + command.paymentKey() + ",amount=" + command.amount());
        notificationPort.enqueue("SMS", plan.getAccountId(), "INSTALLMENT_REPAID",
                "planId=" + command.planId() + ";amount=" + command.amount());
        return result;
    }

    private RepaymentResult applyToPlan(InstallmentPrincipal principal, InstallmentRepayment detached) {
        InstallmentRepayment repayment = repaymentRepository.findById(detached.getPaymentKey())
                .orElseThrow(() -> new IllegalStateException("repayment intent disappeared"));
        if (repayment.isCompleted()) {
            InstallmentPlan plan = planRepository.findById(repayment.getPlanId()).orElseThrow();
            return new RepaymentResult(plan, repayment.getPrincipalApplied(), 0, true);
        }
        InstallmentPlan locked = planRepository.findForUpdate(repayment.getPlanId())
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        requireActive(locked);

        BigDecimal remaining = repayment.getAmount();
        int paidInstallments = 0;
        List<InstallmentSchedule> schedules =
                scheduleRepository.findByPlanIdOrderByInstallmentNo(repayment.getPlanId());
        for (InstallmentSchedule schedule : schedules) {
            if (remaining.signum() == 0) {
                break;
            }
            if (schedule.getStatus() == ScheduleStatus.PAID) {
                continue;
            }
            if (remaining.compareTo(schedule.getPrincipalDue()) < 0) {
                break;
            }
            schedule.markPaid(clock.now());
            scheduleRepository.save(schedule);
            remaining = remaining.subtract(schedule.getPrincipalDue());
            paidInstallments++;
        }
        BigDecimal applied = repayment.getAmount().subtract(remaining);
        if (applied.signum() > 0) {
            locked.repayPrincipal(applied);
            planRepository.saveAndFlush(locked);
        }
        repayment.markCompleted(applied, clock.now());
        repaymentRepository.saveAndFlush(repayment);
        return new RepaymentResult(locked, applied, paidInstallments, false);
    }

    private RepaymentResult replay(String planId, InstallmentRepayment repayment) {
        InstallmentPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        return new RepaymentResult(plan, repayment.getPrincipalApplied(), 0, true);
    }

    private static void requireValidAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new BusinessRuleException("INVALID_PARAMETER", "Repayment amount must be greater than zero.");
        }
        if (amount.stripTrailingZeros().scale() > 2) {
            throw new BusinessRuleException("INVALID_PARAMETER", "Repayment amount supports 2 decimal places.");
        }
    }

    private static void requireActive(InstallmentPlan plan) {
        if (!plan.isActive()) {
            throw new BusinessRuleException("REPAYMENT_NOT_ALLOWED", "Only ACTIVE plans accept repayments.");
        }
    }

    private void recordError(String paymentKey, String message) {
        transactionTemplate.executeWithoutResult(status ->
                repaymentRepository.findById(paymentKey).ifPresent(fresh -> {
                    fresh.markFailed(message, clock.now());
                    repaymentRepository.saveAndFlush(fresh);
                }));
    }
}
