package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.InstallmentApplicationIntent;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRate;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.AccountLockRepository;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentApplicationIntentRepository;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.InstallmentRateRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import com.carddemo.installment.domain.service.EligibilityPolicy;
import com.carddemo.installment.domain.service.FeeScheduleCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import com.carddemo.installment.infrastructure.security.PreviewTokenService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 提交分期（REQ-INS-04）：本金级去重、20 笔上限、去重键幂等、台账过账与补偿。
 * <p>
 * 事务边界（A-002）：先落「创建意图」再跨服务过账，最后在独立事务内建计划。
 * ledger 已提交但响应丢失、或过账成功后本地事务失败，都能凭同一意图/同一 planId 续跑，
 * 不会产生第二组有效分录；无法继续时按同一 planId 冲正，不留无计划的有效入账。
 */
@Service
public class InstallmentApplicationService {

    private static final Logger log = LoggerFactory.getLogger(InstallmentApplicationService.class);

    private static final String RECEIVABLE = "1100-INSTALLMENT-RECEIVABLE";
    private static final String CARDHOLDER_PAYABLE = "2100-CARDHOLDER-PAYABLE";
    private static final String FEE_INCOME = "4001-INSTALLMENT-FEE-INCOME";

    public record CreateCommand(String accountId, SourceType sourceType, String sourceId, BigDecimal principal,
                                int termMonths, String previewToken, boolean agreementAccepted,
                                String idempotencyKey) {
    }

    public record CreateResult(InstallmentPlan plan, boolean replayed) {
    }

    private record IntentOutcome(InstallmentApplicationIntent intent, boolean replayed) {
    }

    private final InstallmentPolicyRepository policyRepository;
    private final InstallmentRateRepository rateRepository;
    private final InstallmentPlanRepository planRepository;
    private final InstallmentScheduleRepository scheduleRepository;
    private final PrincipalAllocationRepository allocationRepository;
    private final EligibilityFlagRepository eligibilityFlagRepository;
    private final AccountLockRepository accountLockRepository;
    private final InstallmentApplicationIntentRepository intentRepository;
    private final AccountPort accountPort;
    private final TransactionPort transactionPort;
    private final BillingPort billingPort;
    private final LedgerPort ledgerPort;
    private final AuditPort auditPort;
    private final NotificationPort notificationPort;
    private final EligibilityPolicy eligibilityPolicy;
    private final FeeScheduleCalculator calculator;
    private final PreviewTokenService previewTokenService;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;

    public InstallmentApplicationService(InstallmentPolicyRepository policyRepository,
                                         InstallmentRateRepository rateRepository,
                                         InstallmentPlanRepository planRepository,
                                         InstallmentScheduleRepository scheduleRepository,
                                         PrincipalAllocationRepository allocationRepository,
                                         EligibilityFlagRepository eligibilityFlagRepository,
                                         AccountLockRepository accountLockRepository,
                                         InstallmentApplicationIntentRepository intentRepository,
                                         AccountPort accountPort,
                                         TransactionPort transactionPort,
                                         BillingPort billingPort,
                                         LedgerPort ledgerPort,
                                         AuditPort auditPort,
                                         NotificationPort notificationPort,
                                         EligibilityPolicy eligibilityPolicy,
                                         FeeScheduleCalculator calculator,
                                         PreviewTokenService previewTokenService,
                                         AccessGuard accessGuard,
                                         ClockProvider clock,
                                         PlatformTransactionManager transactionManager) {
        this.policyRepository = policyRepository;
        this.rateRepository = rateRepository;
        this.planRepository = planRepository;
        this.scheduleRepository = scheduleRepository;
        this.allocationRepository = allocationRepository;
        this.eligibilityFlagRepository = eligibilityFlagRepository;
        this.accountLockRepository = accountLockRepository;
        this.intentRepository = intentRepository;
        this.accountPort = accountPort;
        this.transactionPort = transactionPort;
        this.billingPort = billingPort;
        this.ledgerPort = ledgerPort;
        this.auditPort = auditPort;
        this.notificationPort = notificationPort;
        this.eligibilityPolicy = eligibilityPolicy;
        this.calculator = calculator;
        this.previewTokenService = previewTokenService;
        this.accessGuard = accessGuard;
        this.clock = clock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public CreateResult create(InstallmentPrincipal principal, CreateCommand command) {
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new BusinessRuleException("CONFIGURATION_MISSING", "Installment policy is missing"));

        InstallmentApplicationIntent replay = intentRepository.findByIdempotencyKey(command.idempotencyKey())
                .orElse(null);
        if (replay != null) {
            return resumeOrReplay(principal, replay, policy, command, true);
        }

        // BR-INS-14：试算令牌由本次请求参数签发且未过期；重放命中时不再要求令牌仍有效
        PreviewTokenService.PreviewPayload payload =
                previewTokenService.verify(command.previewToken(), clock.now());
        previewTokenService.requireMatches(payload, command.accountId(), command.sourceType(),
                command.sourceId(), command.principal(), command.termMonths());
        eligibilityPolicy.requireAgreement(command.agreementAccepted());
        eligibilityPolicy.requireTerm(command.termMonths());
        eligibilityPolicy.requireMinimumAmount(command.sourceType(), command.principal(), policy);
        accessGuard.requireWriteAccess(principal, command.accountId());

        BigDecimal rate = rateRepository.findById(command.termMonths())
                .map(InstallmentRate::getMonthlyFeeRate)
                .orElseThrow(() -> new BusinessRuleException("INVALID_TERM", "No rate configured"));
        if (payload.monthlyFeeRate().compareTo(rate) != 0) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Pricing changed since preview; please preview again.");
        }

        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(command.principal(), command.termMonths(), rate);

        // BR-INS-11 单账户并发闸门；锁内重查幂等键（A-008 同键并发返回同一计划且标记为重放）
        IntentOutcome outcome = transactionTemplate.execute(status -> {
            accountLockRepository.ensureExists(command.accountId());
            accountLockRepository.lockByAccountId(command.accountId())
                    .orElseThrow(() -> new IllegalStateException("account lock row missing"));
            InstallmentApplicationIntent concurrent =
                    intentRepository.findByIdempotencyKey(command.idempotencyKey()).orElse(null);
            if (concurrent != null) {
                return new IntentOutcome(concurrent, true);
            }
            long activePlans = planRepository.countByAccountIdAndStatus(command.accountId(), PlanStatus.ACTIVE);
            eligibilityPolicy.requireCapacity(activePlans, policy);
            String intentId = UUID.randomUUID().toString().replace("-", "").substring(0, 30);
            return new IntentOutcome(intentRepository.saveAndFlush(new InstallmentApplicationIntent(intentId,
                    command.idempotencyKey(), command.accountId(), command.sourceType(), command.sourceId(),
                    command.principal(), command.termMonths(), rate, schedule.totalFee(), "IP" + intentId,
                    clock.now())), false);
        });
        if (outcome == null) {
            throw new IllegalStateException("installment intent was not persisted");
        }

        return resumeOrReplay(principal, outcome.intent(), policy, command, outcome.replayed());
    }

    /** 续跑或重放同一幂等键的创建意图。 */
    private CreateResult resumeOrReplay(InstallmentPrincipal principal, InstallmentApplicationIntent intent,
                                        InstallmentPolicy policy, CreateCommand command, boolean replayed) {
        accessGuard.requireWriteAccess(principal, intent.getAccountId());
        requireSameRequest(intent, command);

        if (intent.isCompleted()) {
            requireWithinWindow(intent, policy);
            InstallmentPlan plan = planRepository.findById(intent.getPlanId())
                    .orElseThrow(() -> new IllegalStateException(
                            "completed installment intent has no plan: " + intent.getIntentId()));
            return new CreateResult(plan, true);
        }
        if (intent.isCompensationPending()) {
            // A-R001：补偿决定已持久化 → 只允许幂等完成同一逆向，即使原拒绝原因已解除也不得前向完成
            completeCompensation(intent);
            throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                    "A previous attempt with this key was compensated; please use a new key.");
        }
        if (!intent.isResumable()) {
            throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                    "A previous attempt with this key failed and was compensated; please use a new key.");
        }

        try {
            postCreateLedger(intent);
            markLedgerPosted(intent);
            InstallmentPlan plan = transactionTemplate.execute(status -> completePlan(principal, intent));
            return new CreateResult(plan, replayed);
        } catch (BusinessRuleException | NotFoundException ex) {
            compensate(intent, ex.getMessage());
            throw ex;
        } catch (RemoteServiceException ex) {
            recordError(intent, ex.getMessage());
            throw ex;
        }
    }

    private void markLedgerPosted(InstallmentApplicationIntent intent) {
        transactionTemplate.executeWithoutResult(status -> {
            InstallmentApplicationIntent fresh = intentRepository.findById(intent.getIntentId()).orElseThrow();
            fresh.markLedgerPosted(clock.now());
            intentRepository.saveAndFlush(fresh);
        });
    }

    private void recordError(InstallmentApplicationIntent intent, String message) {
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getIntentId()).ifPresent(fresh -> {
                    fresh.recordError(message, clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
    }

    private InstallmentPlan completePlan(InstallmentPrincipal principal, InstallmentApplicationIntent detached) {
        InstallmentApplicationIntent intent = intentRepository.findById(detached.getIntentId())
                .orElseThrow(() -> new IllegalStateException("installment intent disappeared: "
                        + detached.getIntentId()));
        if (intent.isCompensationPending() || InstallmentApplicationIntent.REVERSED.equals(intent.getStatus())) {
            throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                    "This installment intent is being compensated and cannot be completed.");
        }
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new BusinessRuleException("CONFIGURATION_MISSING", "Installment policy is missing"));
        accountLockRepository.ensureExists(intent.getAccountId());
        accountLockRepository.lockByAccountId(intent.getAccountId())
                .orElseThrow(() -> new IllegalStateException("account lock row missing"));

        InstallmentPlan existing = planRepository.findById(intent.getPlanId()).orElse(null);
        if (existing != null) {
            intent.markCompleted(clock.now());
            intentRepository.saveAndFlush(intent);
            return existing;
        }

        long activePlans = planRepository.countByAccountIdAndStatus(intent.getAccountId(), PlanStatus.ACTIVE);
        eligibilityPolicy.requireCapacity(activePlans, policy);

        // A-007：提交时重新校验来源资格（风险标记/占用/可分期本金）
        List<PrincipalAllocation> allocations = resolveAllocations(intent);
        FeeScheduleCalculator.FeeSchedule schedule = calculator.calculate(intent.getPrincipal(),
                intent.getTermMonths(), intent.getMonthlyFeeRate());

        LocalDateTime now = clock.now();
        InstallmentPlan plan = new InstallmentPlan(intent.getPlanId(), intent.getAccountId(), null,
                intent.getSourceType(), intent.getSourceId(), intent.getPrincipal(), intent.getTermMonths(),
                intent.getMonthlyFeeRate(), intent.getTotalFee(), intent.getIdempotencyKey(), now);
        planRepository.save(plan);

        LocalDate anchor = accountAnchorDay(intent.getAccountId());
        LocalDate today = clock.today();
        List<InstallmentSchedule> schedules = new ArrayList<>(schedule.periods().size());
        for (FeeScheduleCalculator.Period period : schedule.periods()) {
            schedules.add(new InstallmentSchedule(
                    intent.getPlanId() + "-" + String.format("%02d", period.installmentNo()),
                    intent.getPlanId(), period.installmentNo(), dueDate(anchor, today, period.installmentNo()),
                    period.principal(), period.fee()));
        }
        scheduleRepository.saveAll(schedules);
        for (PrincipalAllocation allocation : allocations) {
            allocationRepository.save(new PrincipalAllocation(intent.getPlanId(), allocation.getTransactionId(),
                    allocation.getPrincipalAmount()));
        }
        intent.markCompleted(now);
        intentRepository.saveAndFlush(intent);

        auditPort.record(principal.userId(), "INSTALLMENT_CREATED", "INSTALLMENT_PLAN", intent.getPlanId(),
                "principal=" + intent.getPrincipal() + ",term=" + intent.getTermMonths()
                        + ",rate=" + intent.getMonthlyFeeRate());
        notificationPort.enqueue("SMS", intent.getAccountId(), "INSTALLMENT_CREATED",
                "planId=" + intent.getPlanId() + ";principal=" + intent.getPrincipal());
        return plan;
    }

    /**
     * 对账补偿（A-002）：续跑长时间停在 PENDING/LEDGER_POSTED 的创建意图。
     * 同键重试与对账都走同一续跑路径，ledger 幂等因此不会出现第二组有效分录。
     */
    public int reconcilePending() {
        List<InstallmentApplicationIntent> stale = intentRepository.findByStatusInAndUpdatedAtBefore(
                List.of(InstallmentApplicationIntent.PENDING, InstallmentApplicationIntent.LEDGER_POSTED,
                        InstallmentApplicationIntent.COMPENSATION_PENDING),
                clock.now().minusSeconds(5));
        int completed = 0;
        InstallmentPrincipal system = new InstallmentPrincipal("SYSTEM", "A");
        for (InstallmentApplicationIntent intent : stale) {
            if (intent.isCompensationPending()) {
                if (completeCompensation(intent)) {
                    completed++;
                }
                continue;
            }
            try {
                postCreateLedger(intent);
                markLedgerPosted(intent);
                transactionTemplate.execute(status -> completePlan(system, intent));
                completed++;
            } catch (BusinessRuleException | NotFoundException ex) {
                compensate(intent, ex.getMessage());
            } catch (RuntimeException ex) {
                recordError(intent, ex.getMessage());
            }
        }
        return completed;
    }

    /**
     * 冲正（A-002 / A-R001 补偿边界）：同一 planId 反向分录（稳定作用ID，重复调用只冲正一次）。
     * 冲正失败时不进入不可续跑的 REVERSED，而是保持 PENDING/LEDGER_POSTED 由同键重试或对账继续，
     * 直到反向分录真实成功才终结为 REVERSED。
     */
    private void compensate(InstallmentApplicationIntent intent, String reason) {
        // ① 先把「补偿决定」落库（独立事务），之后的崩溃/丢响应都只能走逆向
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(intent.getIntentId()).ifPresent(fresh -> {
                    fresh.markCompensationPending(clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
        completeCompensation(intent, reason);
    }

    /**
     * 只完成逆向（可重复调用）：用稳定作用ID {@code planId-REV} 冲正，成功后置 REVERSED。
     * 逆向过账失败或响应丢失时保持 COMPENSATION_PENDING，下一次重试/对账会幂等完成同一逆向。
     */
    private boolean completeCompensation(InstallmentApplicationIntent detached) {
        return completeCompensation(detached, detached.getLastError());
    }

    private boolean completeCompensation(InstallmentApplicationIntent detached, String reason) {
        try {
            postReversalLedger(detached);
        } catch (RemoteServiceException ex) {
            log.warn("installment reversal not confirmed yet, staying COMPENSATION_PENDING: planId={}",
                    detached.getPlanId());
            transactionTemplate.executeWithoutResult(status ->
                    intentRepository.findById(detached.getIntentId()).ifPresent(fresh -> {
                        fresh.recordError("reversal pending: " + ex.getMessage(), clock.now());
                        intentRepository.saveAndFlush(fresh);
                    }));
            return false;
        }
        transactionTemplate.executeWithoutResult(status ->
                intentRepository.findById(detached.getIntentId()).ifPresent(fresh -> {
                    fresh.markReversed(reason == null ? "compensated" : reason, clock.now());
                    intentRepository.saveAndFlush(fresh);
                }));
        return true;
    }

    private void postCreateLedger(InstallmentApplicationIntent intent) {
        List<LedgerPort.JournalLine> lines = new ArrayList<>(3);
        lines.add(new LedgerPort.JournalLine(RECEIVABLE, "DEBIT",
                intent.getPrincipal().add(intent.getTotalFee()), "installment receivable"));
        lines.add(new LedgerPort.JournalLine(CARDHOLDER_PAYABLE, "CREDIT", intent.getPrincipal(),
                "purchase principal moved to installment receivable"));
        if (intent.getTotalFee().signum() > 0) {
            lines.add(new LedgerPort.JournalLine(FEE_INCOME, "CREDIT", intent.getTotalFee(),
                    "installment fee income"));
        }
        ledgerPort.postGroup(intent.getPlanId(), "INSTALLMENT_CREATE", intent.getPlanId(), lines);
    }

    private void postReversalLedger(InstallmentApplicationIntent intent) {
        List<LedgerPort.JournalLine> lines = new ArrayList<>(3);
        lines.add(new LedgerPort.JournalLine(CARDHOLDER_PAYABLE, "DEBIT", intent.getPrincipal(),
                "reversal: purchase principal restored"));
        if (intent.getTotalFee().signum() > 0) {
            lines.add(new LedgerPort.JournalLine(FEE_INCOME, "DEBIT", intent.getTotalFee(),
                    "reversal: installment fee income"));
        }
        lines.add(new LedgerPort.JournalLine(RECEIVABLE, "CREDIT",
                intent.getPrincipal().add(intent.getTotalFee()), "reversal: installment receivable"));
        ledgerPort.postGroup(intent.getPlanId() + "-REV", "INSTALLMENT_CREATE_REVERSAL",
                intent.getPlanId(), lines);
    }

    private void requireSameRequest(InstallmentApplicationIntent intent, CreateCommand command) {
        boolean same = intent.getAccountId().equals(command.accountId())
                && intent.getSourceType() == command.sourceType()
                && intent.getSourceId().equals(command.sourceId())
                && intent.getPrincipal().compareTo(command.principal()) == 0
                && intent.getTermMonths() == command.termMonths();
        if (!same) {
            throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                    "Idempotency key is already used by a different installment request.");
        }
    }

    private void requireWithinWindow(InstallmentApplicationIntent intent, InstallmentPolicy policy) {
        LocalDateTime deadline = intent.getCreatedAt().plusMinutes(policy.getIdempotencyWindowMinutes());
        if (!clock.now().isBefore(deadline)) {
            throw new BusinessRuleException("IDEMPOTENCY_KEY_EXPIRED",
                    "Idempotency key is outside the " + policy.getIdempotencyWindowMinutes()
                            + "-minute replay window; please submit again.");
        }
    }

    /**
     * 本金级去重：单笔只占该交易本金；账单按最早未占用交易逐笔分摊（BR-INS-09）。
     * 争议/逾期交易在两种来源下都不可分期（A-007）。
     */
    private List<PrincipalAllocation> resolveAllocations(InstallmentApplicationIntent intent) {
        if (intent.getSourceType() == SourceType.TRANSACTION) {
            TransactionPort.TransactionView transaction = transactionPort.findTransaction(intent.getSourceId())
                    .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction not found."));
            if (!transaction.accountId().equals(intent.getAccountId())) {
                throw new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction does not belong to this account.");
            }
            eligibilityPolicy.requirePostedTransaction(transaction.status());
            requireNoRiskFlag(intent.getSourceId());
            if (allocationRepository.existsByTransactionId(intent.getSourceId())) {
                throw new BusinessRuleException("ALREADY_INSTALLED",
                        "This transaction principal is already installmented.");
            }
            eligibilityPolicy.requireWithinAvailable(intent.getPrincipal(), transaction.amount());
            List<PrincipalAllocation> allocations = new ArrayList<>(1);
            allocations.add(new PrincipalAllocation(null, intent.getSourceId(), intent.getPrincipal()));
            return allocations;
        }

        BillingPort.BillingStatement statement = billingPort.currentStatement(intent.getAccountId());
        Map<String, BigDecimal> allocated = new HashMap<>();
        for (PrincipalAllocation existing : allocationRepository.findByTransactionIdIn(
                statement.lines().stream().map(BillingPort.BillingLine::transactionId).toList())) {
            allocated.merge(existing.getTransactionId(), existing.getPrincipalAmount(), BigDecimal::add);
        }
        BigDecimal needed = intent.getPrincipal();
        List<PrincipalAllocation> allocations = new ArrayList<>();
        for (BillingPort.BillingLine line : statement.lines()) {
            if (needed.signum() == 0) {
                break;
            }
            requireNoRiskFlag(line.transactionId());
            BigDecimal free = line.amount().subtract(
                    allocated.getOrDefault(line.transactionId(), BigDecimal.ZERO.setScale(2)));
            if (free.signum() <= 0) {
                continue;
            }
            BigDecimal take = free.min(needed);
            allocations.add(new PrincipalAllocation(null, line.transactionId(), take));
            needed = needed.subtract(take);
        }
        if (needed.signum() > 0) {
            throw new BusinessRuleException("PRINCIPAL_EXCEEDS_LIMIT",
                    "Bill available principal is " + statement.availablePrincipal());
        }
        return allocations;
    }

    private void requireNoRiskFlag(String transactionId) {
        var flag = eligibilityFlagRepository.findById(transactionId).orElse(null);
        eligibilityPolicy.requireNoRiskFlag(flag != null && flag.isDisputed(), flag != null && flag.isDelinquent());
    }

    private LocalDate accountAnchorDay(String accountId) {
        AccountPort.AccountSnapshot account = accountPort.getAccount(accountId);
        return account.openDate();
    }

    /** BR-INS-08 / AC-18：T+1 生效，首期落在下一个账单周期，按期推进。 */
    static LocalDate dueDate(LocalDate anchorDate, LocalDate today, int installmentNo) {
        YearMonth month = YearMonth.from(today).plusMonths(installmentNo);
        int day = Math.min(anchorDate.getDayOfMonth(), month.lengthOfMonth());
        return month.atDay(day);
    }
}
