package com.carddemo.installment.domain.service;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.SourceType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Set;

/**
 * 准入规则（BR-INS-01/02/06/15）：
 * 只校验来源状态、金额/可分期本金余额、期数与 20 笔上限；
 * 不引入「账户可用额度 ≥ 分期本金」门槛（PRD v1.1 PRD-001）。
 */
@Component
public class EligibilityPolicy {

    public static final Set<Integer> ALLOWED_TERMS = Set.of(3, 6, 12);

    public void requireTerm(int termMonths) {
        if (!ALLOWED_TERMS.contains(termMonths)) {
            throw new BusinessRuleException("INVALID_TERM", "Only 3, 6 or 12 periods are supported.");
        }
    }

    public void requireMinimumAmount(SourceType sourceType, BigDecimal principal, InstallmentPolicy policy) {
        BigDecimal minimum = sourceType == SourceType.BILL
                ? policy.getMinBillAmount()
                : policy.getMinTransactionAmount();
        if (principal == null || principal.compareTo(minimum) < 0) {
            throw new BusinessRuleException("INSTALLMENT_NOT_ELIGIBLE",
                    "Minimum principal for " + sourceType + " is " + minimum);
        }
    }

    public void requireWithinAvailable(BigDecimal principal, BigDecimal availablePrincipal) {
        if (principal.compareTo(availablePrincipal) > 0) {
            throw new BusinessRuleException("PRINCIPAL_EXCEEDS_LIMIT",
                    "Maximum installable principal is " + availablePrincipal);
        }
    }

    public void requirePostedTransaction(String status) {
        if (!"POSTED".equals(status)) {
            throw new BusinessRuleException("INSTALLMENT_NOT_ELIGIBLE",
                    "Only POSTED transactions are installable.");
        }
    }

    public void requireNoRiskFlag(boolean disputed, boolean delinquent) {
        if (disputed || delinquent) {
            throw new BusinessRuleException("INSTALLMENT_NOT_ELIGIBLE",
                    "Disputed or delinquent transactions are not installable.");
        }
    }

    public void requireCapacity(long activePlanCount, InstallmentPolicy policy) {
        if (activePlanCount >= policy.getMaxActivePlansPerAccount()) {
            throw new BusinessRuleException("INSTALLMENT_LIMIT_EXCEEDED",
                    "Active installment plan limit reached: " + policy.getMaxActivePlansPerAccount());
        }
    }

    public void requireAgreement(boolean agreementAccepted) {
        if (!agreementAccepted) {
            throw new BusinessRuleException("AGREEMENT_REQUIRED", "Installment agreement must be accepted.");
        }
    }
}
