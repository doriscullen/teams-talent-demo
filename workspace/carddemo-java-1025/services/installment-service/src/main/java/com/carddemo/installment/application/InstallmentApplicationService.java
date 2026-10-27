package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.AccountLockRepository;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.InstallmentRateRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import com.carddemo.installment.domain.service.EligibilityPolicy;
import com.carddemo.installment.domain.service.FeeScheduleCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import com.carddemo.installment.infrastructure.security.PreviewTokenService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
 * 事务边界：本方法一个本地事务；ledger 过账失败抛 503 由事务回滚，不留计划/还款计划/占用记录（US-007）。
 * 本金已计入 current_balance，创建时不再扣减可用额度（BR-INS-10）。
 */
@Service
public class InstallmentApplicationService {

    public record CreateCommand(String accountId, SourceType sourceType, String sourceId, BigDecimal principal,
                                int termMonths, String previewToken, boolean agreementAccepted,
                                String idempotencyKey) {
    }

    public record CreateResult(InstallmentPlan plan, boolean replayed) {
    }

    private final InstallmentPolicyRepository policyRepository;
    private final InstallmentRateRepository rateRepository;
    private final InstallmentPlanRepository planRepository;
    private final InstallmentScheduleRepository scheduleRepository;
    private final PrincipalAllocationRepository allocationRepository;
    private final EligibilityFlagRepository eligibilityFlagRepository;
    private final AccountLockRepository accountLockRepository;
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

    public InstallmentApplicationService(InstallmentPolicyRepository policyRepository,
                                         InstallmentRateRepository rateRepository,
                                         InstallmentPlanRepository planRepository,
                                         InstallmentScheduleRepository scheduleRepository,
                                         PrincipalAllocationRepository allocationRepository,
                                         EligibilityFlagRepository eligibilityFlagRepository,
                                         AccountLockRepository accountLockRepository,
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
                                         ClockProvider clock) {
        this.policyRepository = policyRepository;
        this.rateRepository = rateRepository;
        this.planRepository = planRepository;
        this.scheduleRepository = scheduleRepository;
        this.allocationRepository = allocationRepository;
        this.eligibilityFlagRepository = eligibilityFlagRepository;
        this.accountLockRepository = accountLockRepository;
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
    }

    @Transactional
    public CreateResult create(InstallmentPrincipal principal, CreateCommand command) {
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new BusinessRuleException("CONFIGURATION_MISSING", "Installment policy is missing"));

        // BR-INS-14：试算令牌必须由本次请求参数签发且未过期，重放命中时不再要求令牌仍有效
        InstallmentPlan replayCandidate = planRepository.findByIdempotencyKey(command.idempotencyKey()).orElse(null);
        if (replayCandidate != null) {
            if (!replayCandidate.getAccountId().equals(command.accountId())) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                        "Idempotency key is already used by another account.");
            }
            accessGuard.requireWriteAccess(principal, replayCandidate.getAccountId());
            return new CreateResult(replayCandidate, true);
        }

        PreviewTokenService.PreviewPayload payload =
                previewTokenService.verify(command.previewToken(), clock.now());
        previewTokenService.requireMatches(payload, command.accountId(), command.sourceType(),
                command.sourceId(), command.principal(), command.termMonths());
        eligibilityPolicy.requireAgreement(command.agreementAccepted());
        eligibilityPolicy.requireTerm(command.termMonths());
        eligibilityPolicy.requireMinimumAmount(command.sourceType(), command.principal(), policy);
        accessGuard.requireWriteAccess(principal, command.accountId());

        BigDecimal rate = rateRepository.findById(command.termMonths())
                .map(com.carddemo.installment.domain.model.InstallmentRate::getMonthlyFeeRate)
                .orElseThrow(() -> new BusinessRuleException("INVALID_TERM", "No rate configured"));
        if (payload.monthlyFeeRate().compareTo(rate) != 0) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Pricing changed since preview; please preview again.");
        }

        // BR-INS-11：单账户并发闸门 + ACTIVE 计数
        accountLockRepository.ensureExists(command.accountId());
        accountLockRepository.lockByAccountId(command.accountId())
                .orElseThrow(() -> new IllegalStateException("account lock row missing"));
        long activePlans = planRepository.countByAccountIdAndStatus(command.accountId(), PlanStatus.ACTIVE);
        eligibilityPolicy.requireCapacity(activePlans, policy);

        List<PrincipalAllocation> allocations = resolveAllocations(command);
        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(command.principal(), command.termMonths(), rate);

        LocalDateTime now = clock.now();
        String planId = "IP" + UUID.randomUUID().toString().replace("-", "").substring(0, 30);
        InstallmentPlan plan = new InstallmentPlan(planId, command.accountId(), null, command.sourceType(),
                command.sourceId(), command.principal(), command.termMonths(), rate, schedule.totalFee(),
                command.idempotencyKey(), now);
        planRepository.save(plan);

        LocalDate anchor = accountAnchorDay(command.accountId());
        LocalDate today = clock.today();
        List<InstallmentSchedule> schedules = new ArrayList<>(schedule.periods().size());
        for (FeeScheduleCalculator.Period period : schedule.periods()) {
            schedules.add(new InstallmentSchedule(
                    planId + "-" + String.format("%02d", period.installmentNo()),
                    planId, period.installmentNo(), dueDate(anchor, today, period.installmentNo()),
                    period.principal(), period.fee()));
        }
        scheduleRepository.saveAll(schedules);
        for (PrincipalAllocation allocation : allocations) {
            allocationRepository.save(new PrincipalAllocation(planId, allocation.getTransactionId(),
                    allocation.getPrincipalAmount()));
        }

        // A-04：手续费收入过账。ledger 不可用 → 503，本地事务回滚，不留半完成状态
        ledgerPort.postGroup(planId, "INSTALLMENT_CREATE", planId, List.of(
                new LedgerPort.JournalLine("1100-INSTALLMENT-RECEIVABLE", "DEBIT", command.principal(),
                        "installment principal"),
                new LedgerPort.JournalLine("4001-INSTALLMENT-FEE-INCOME", "CREDIT", schedule.totalFee(),
                        "installment fee income")));

        auditPort.record(principal.userId(), "INSTALLMENT_CREATED", "INSTALLMENT_PLAN", planId,
                "principal=" + command.principal() + ",term=" + command.termMonths() + ",rate=" + rate);
        notificationPort.enqueue("SMS", command.accountId(), "INSTALLMENT_CREATED",
                "planId=" + planId + ";principal=" + command.principal());
        return new CreateResult(plan, false);
    }

    /** 本金级去重：单笔只占该交易本金；账单按最早未占用交易逐笔分摊（BR-INS-09）。 */
    private List<PrincipalAllocation> resolveAllocations(CreateCommand command) {
        if (command.sourceType() == SourceType.TRANSACTION) {
            TransactionPort.TransactionView transaction = transactionPort.findTransaction(command.sourceId())
                    .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction not found."));
            if (!transaction.accountId().equals(command.accountId())) {
                throw new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction does not belong to this account.");
            }
            eligibilityPolicy.requirePostedTransaction(transaction.status());
            var flag = eligibilityFlagRepository.findById(command.sourceId()).orElse(null);
            eligibilityPolicy.requireNoRiskFlag(flag != null && flag.isDisputed(), flag != null && flag.isDelinquent());
            if (allocationRepository.existsByTransactionId(command.sourceId())) {
                throw new BusinessRuleException("ALREADY_INSTALLED", "This transaction principal is already installmented.");
            }
            eligibilityPolicy.requireWithinAvailable(command.principal(), transaction.amount());
            List<PrincipalAllocation> allocations = new ArrayList<>(1);
            allocations.add(new PrincipalAllocation(null, command.sourceId(), command.principal()));
            return allocations;
        }

        BillingPort.BillingStatement statement = billingPort.currentStatement(command.accountId());
        Map<String, BigDecimal> allocated = new HashMap<>();
        for (PrincipalAllocation existing : allocationRepository.findByTransactionIdIn(
                statement.lines().stream().map(BillingPort.BillingLine::transactionId).toList())) {
            allocated.merge(existing.getTransactionId(), existing.getPrincipalAmount(), BigDecimal::add);
        }
        BigDecimal needed = command.principal();
        List<PrincipalAllocation> allocations = new ArrayList<>();
        for (BillingPort.BillingLine line : statement.lines()) {
            if (needed.signum() == 0) {
                break;
            }
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
