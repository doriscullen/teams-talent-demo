package com.carddemo.installment.domain.service;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.SourceType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** BR-INS-01/02/06/11/15 边界：金额 min-1/min、期数、20 笔上限、协议与风险信号。 */
class EligibilityPolicyTest {

    private final EligibilityPolicy policy = new EligibilityPolicy();

    private InstallmentPolicy configured(int maxActivePlans) {
        InstallmentPolicy mock = mock(InstallmentPolicy.class);
        when(mock.getMinTransactionAmount()).thenReturn(new BigDecimal("100.00"));
        when(mock.getMinBillAmount()).thenReturn(new BigDecimal("500.00"));
        when(mock.getMaxActivePlansPerAccount()).thenReturn(maxActivePlans);
        return mock;
    }

    @Test
    void transactionMinimumAmountBoundary() {
        InstallmentPolicy settings = configured(20);
        assertThatThrownBy(() -> policy.requireMinimumAmount(SourceType.TRANSACTION,
                new BigDecimal("99.99"), settings))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_NOT_ELIGIBLE");
        assertThatCode(() -> policy.requireMinimumAmount(SourceType.TRANSACTION,
                new BigDecimal("100.00"), settings)).doesNotThrowAnyException();
    }

    @Test
    void billMinimumAmountBoundary() {
        InstallmentPolicy settings = configured(20);
        assertThatThrownBy(() -> policy.requireMinimumAmount(SourceType.BILL,
                new BigDecimal("499.99"), settings))
                .isInstanceOf(BusinessRuleException.class);
        assertThatCode(() -> policy.requireMinimumAmount(SourceType.BILL,
                new BigDecimal("500.00"), settings)).doesNotThrowAnyException();
    }

    @Test
    void onlyThreeSixTwelvePeriodsAreAllowed() {
        assertThatCode(() -> policy.requireTerm(3)).doesNotThrowAnyException();
        assertThatCode(() -> policy.requireTerm(6)).doesNotThrowAnyException();
        assertThatCode(() -> policy.requireTerm(12)).doesNotThrowAnyException();
        for (int term : new int[]{1, 2, 9, 24, 0}) {
            assertThatThrownBy(() -> policy.requireTerm(term))
                    .isInstanceOf(BusinessRuleException.class)
                    .extracting(ex -> ((BusinessRuleException) ex).getCode())
                    .isEqualTo("INVALID_TERM");
        }
    }

    @Test
    void twentyActivePlansAllowTwentiethAndRejectTwentyFirst() {
        InstallmentPolicy settings = configured(20);
        assertThatCode(() -> policy.requireCapacity(19, settings)).doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.requireCapacity(20, settings))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_LIMIT_EXCEEDED");
    }

    @Test
    void principalAboveAvailablePrincipalIsRejected() {
        assertThatThrownBy(() -> policy.requireWithinAvailable(
                new BigDecimal("1000.01"), new BigDecimal("1000.00")))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PRINCIPAL_EXCEEDS_LIMIT");
        assertThatCode(() -> policy.requireWithinAvailable(
                new BigDecimal("1000.00"), new BigDecimal("1000.00"))).doesNotThrowAnyException();
    }

    @Test
    void onlyPostedTransactionsWithoutRiskFlagsAreEligible() {
        assertThatCode(() -> policy.requirePostedTransaction("POSTED")).doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.requirePostedTransaction("PENDING"))
                .isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> policy.requireNoRiskFlag(true, false))
                .isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> policy.requireNoRiskFlag(false, true))
                .isInstanceOf(BusinessRuleException.class);
        assertThatCode(() -> policy.requireNoRiskFlag(false, false)).doesNotThrowAnyException();
    }

    @Test
    void agreementMustBeAccepted() {
        assertThatThrownBy(() -> policy.requireAgreement(false))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("AGREEMENT_REQUIRED");
        assertThatCode(() -> policy.requireAgreement(true)).doesNotThrowAnyException();
    }
}
