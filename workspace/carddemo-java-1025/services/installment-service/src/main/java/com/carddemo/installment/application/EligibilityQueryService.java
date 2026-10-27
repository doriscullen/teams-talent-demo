package com.carddemo.installment.application;

import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 入口资格与账单投影（C-01 / C-04）：前端不能靠金额自行推导资格，
 * 必须读服务端真实来源状态（入账状态、逾期/争议信号、本金占用、最低金额）。
 */
@Service
public class EligibilityQueryService {

    public record TransactionEligibility(String transactionId, String accountId, BigDecimal amount,
                                         boolean eligible, String reason, boolean alreadyInstalled,
                                         String existingPlanId, BigDecimal minAmount) {
    }

    public record BillLine(String transactionId, BigDecimal amount, LocalDate postedDate, String description) {
    }

    public record BillView(String billId, String accountId, LocalDate cycleStart, LocalDate cycleEnd,
                           BigDecimal billPrincipal, BigDecimal availablePrincipal, BigDecimal minBillAmount,
                           List<BillLine> lines) {
    }

    private final TransactionPort transactionPort;
    private final BillingPort billingPort;
    private final EligibilityFlagRepository eligibilityFlagRepository;
    private final PrincipalAllocationRepository allocationRepository;
    private final InstallmentPolicyRepository policyRepository;
    private final AccessGuard accessGuard;

    public EligibilityQueryService(TransactionPort transactionPort,
                                   BillingPort billingPort,
                                   EligibilityFlagRepository eligibilityFlagRepository,
                                   PrincipalAllocationRepository allocationRepository,
                                   InstallmentPolicyRepository policyRepository,
                                   AccessGuard accessGuard) {
        this.transactionPort = transactionPort;
        this.billingPort = billingPort;
        this.eligibilityFlagRepository = eligibilityFlagRepository;
        this.allocationRepository = allocationRepository;
        this.policyRepository = policyRepository;
        this.accessGuard = accessGuard;
    }

    @Transactional(readOnly = true)
    public TransactionEligibility transactionEligibility(InstallmentPrincipal principal, String accountId,
                                                         String transactionId) {
        accessGuard.requireReadAccess(principal, accountId);
        TransactionPort.TransactionView transaction = transactionPort.findTransaction(transactionId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction not found."));
        if (!transaction.accountId().equals(accountId)) {
            throw new NotFoundException("INSTALLMENT_NOT_FOUND", "Transaction does not belong to this account.");
        }
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment policy is missing"));

        PrincipalAllocation allocation = allocationRepository.findFirstByTransactionId(transactionId).orElse(null);
        EligibilityFlag flag = eligibilityFlagRepository.findById(transactionId).orElse(null);

        String reason = null;
        if (!"01".equals(transaction.typeCode())) {
            reason = "NOT_PURCHASE";
        } else if (!"POSTED".equals(transaction.status())) {
            reason = "NOT_POSTED";
        } else if (flag != null && flag.isDisputed()) {
            reason = "DISPUTED";
        } else if (flag != null && flag.isDelinquent()) {
            reason = "DELINQUENT";
        } else if (transaction.amount().compareTo(policy.getMinTransactionAmount()) < 0) {
            reason = "BELOW_MIN_AMOUNT";
        }
        boolean alreadyInstalled = allocation != null;
        return new TransactionEligibility(transactionId, accountId, transaction.amount(),
                reason == null && !alreadyInstalled, reason, alreadyInstalled,
                allocation == null ? null : allocation.getPlanId(), policy.getMinTransactionAmount());
    }

    @Transactional(readOnly = true)
    public BillView currentBill(InstallmentPrincipal principal, String accountId) {
        accessGuard.requireReadAccess(principal, accountId);
        BillingPort.BillingStatement statement = billingPort.currentStatement(accountId);
        InstallmentPolicy policy = policyRepository.findById((short) 1)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment policy is missing"));
        return new BillView(statement.billId(), statement.accountId(), statement.cycleStart(),
                statement.cycleEnd(), statement.billPrincipal(), statement.availablePrincipal(),
                policy.getMinBillAmount(),
                statement.lines().stream()
                        .map(line -> new BillLine(line.transactionId(), line.amount(), line.postedDate(),
                                line.description()))
                        .toList());
    }
}
