package com.carddemo.installment.application;

import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRate;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
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
import java.util.List;

/**
 * 试算（REQ-INS-03 / BR-INS-01/02/03/06/15）：不落库、不产生资金状态，
 * 返回自签名 previewToken 供提交复用（BR-INS-14）。
 */
@Service
public class PreviewService {

    public record PreviewCommand(String accountId, SourceType sourceType, String sourceId,
                                 BigDecimal principal, int termMonths) {
    }

    public record PreviewResult(String previewToken, String sourceType, String sourceId,
                                BigDecimal principal, int termMonths, BigDecimal monthlyFeeRate,
                                BigDecimal totalFee, BigDecimal firstPeriodTotal,
                                List<FeeScheduleCalculator.Period> periods,
                                String billId, LocalDate cycleStart, BigDecimal availablePrincipal) {
    }

    private final InstallmentPolicyRepository policyRepository;
    private final InstallmentRateRepository rateRepository;
    private final EligibilityFlagRepository eligibilityFlagRepository;
    private final PrincipalAllocationRepository allocationRepository;
    private final TransactionPort transactionPort;
    private final BillingPort billingPort;
    private final EligibilityPolicy eligibilityPolicy;
    private final FeeScheduleCalculator calculator;
    private final PreviewTokenService previewTokenService;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;

    public PreviewService(InstallmentPolicyRepository policyRepository,
                          InstallmentRateRepository rateRepository,
                          EligibilityFlagRepository eligibilityFlagRepository,
                          PrincipalAllocationRepository allocationRepository,
                          TransactionPort transactionPort,
                          BillingPort billingPort,
                          EligibilityPolicy eligibilityPolicy,
                          FeeScheduleCalculator calculator,
                          PreviewTokenService previewTokenService,
                          AccessGuard accessGuard,
                          ClockProvider clock) {
        this.policyRepository = policyRepository;
        this.rateRepository = rateRepository;
        this.eligibilityFlagRepository = eligibilityFlagRepository;
        this.allocationRepository = allocationRepository;
        this.transactionPort = transactionPort;
        this.billingPort = billingPort;
        this.eligibilityPolicy = eligibilityPolicy;
        this.calculator = calculator;
        this.previewTokenService = previewTokenService;
        this.accessGuard = accessGuard;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PreviewResult preview(InstallmentPrincipal principal, PreviewCommand command) {
        // A-004：试算同样校验账户归属/后台权限，越权一律 404，不返回他人本金/账单号
        accessGuard.requireReadAccess(principal, command.accountId());
        InstallmentPolicy policy = policy();
        eligibilityPolicy.requireTerm(command.termMonths());
        eligibilityPolicy.requireMinimumAmount(command.sourceType(), command.principal(), policy);

        BigDecimal available;
        String billId = null;
        LocalDate cycleStart = null;
        if (command.sourceType() == SourceType.TRANSACTION) {
            available = transactionAvailablePrincipal(command.accountId(), command.sourceId());
        } else {
            BillingPort.BillingStatement statement = billingPort.currentStatement(command.accountId());
            available = statement.availablePrincipal();
            billId = statement.billId();
            cycleStart = statement.cycleStart();
        }
        eligibilityPolicy.requireWithinAvailable(command.principal(), available);

        BigDecimal rate = rate(command.termMonths());
        FeeScheduleCalculator.FeeSchedule schedule = calculator.calculate(command.principal(), command.termMonths(), rate);
        String token = previewTokenService.issue(new PreviewTokenService.PreviewPayload(
                command.accountId(), command.sourceType(), command.sourceId(), command.principal(),
                command.termMonths(), rate, clock.now()));
        return new PreviewResult(token, command.sourceType().name(), command.sourceId(), command.principal(),
                command.termMonths(), rate, schedule.totalFee(), schedule.firstPeriodTotal(),
                schedule.periods(), billId, cycleStart, available);
    }

    /** 单笔可分期本金：交易必须属于该账户、已入账、无逾期/争议、且本金未被占用。 */
    BigDecimal transactionAvailablePrincipal(String accountId, String transactionId) {
        TransactionPort.TransactionView transaction = transactionPort.findTransaction(transactionId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction not found."));
        if (!transaction.accountId().equals(accountId)) {
            throw new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction does not belong to this account.");
        }
        eligibilityPolicy.requirePostedTransaction(transaction.status());
        EligibilityFlag flag = eligibilityFlagRepository.findById(transactionId).orElse(null);
        eligibilityPolicy.requireNoRiskFlag(flag != null && flag.isDisputed(), flag != null && flag.isDelinquent());
        if (allocationRepository.existsByTransactionId(transactionId)) {
            throw new BusinessRuleException("ALREADY_INSTALLED", "This transaction principal is already installmented.");
        }
        return transaction.amount();
    }

    public InstallmentPolicy policy() {
        return policyRepository.findById((short) 1)
                .orElseThrow(() -> new RemoteServiceException("installment-policy", "Installment policy is missing"));
    }

    public BigDecimal rate(int termMonths) {
        InstallmentRate rate = rateRepository.findById(termMonths)
                .orElseThrow(() -> new BusinessRuleException("INVALID_TERM", "No rate configured for term " + termMonths));
        return rate.getMonthlyFeeRate();
    }
}
