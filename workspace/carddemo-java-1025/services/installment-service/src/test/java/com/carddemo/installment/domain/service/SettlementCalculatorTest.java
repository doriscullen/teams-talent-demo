package com.carddemo.installment.domain.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** BR-INS-12 / US-005：剩余 600.00 → 违约金 6.00、减免 0.00、结清合计 606.00。 */
class SettlementCalculatorTest {

    private final SettlementCalculator calculator = new SettlementCalculator();

    @Test
    void us005SettlementMatchesProfileValues() {
        SettlementCalculator.SettlementQuote quote =
                calculator.quote(new BigDecimal("600.00"), BigDecimal.ZERO, new BigDecimal("0.0100"));

        assertThat(quote.remainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(quote.penaltyFee()).isEqualByComparingTo("6.00");
        assertThat(quote.feeRebate()).isEqualByComparingTo("0.00");
        assertThat(quote.settlementTotal()).isEqualByComparingTo("606.00");
    }

    @Test
    void penaltyRoundsHalfUpToTwoDecimals() {
        SettlementCalculator.SettlementQuote quote =
                calculator.quote(new BigDecimal("550.50"), null, new BigDecimal("0.0100"));
        assertThat(quote.penaltyFee()).isEqualByComparingTo("5.51");
        assertThat(quote.settlementTotal()).isEqualByComparingTo("556.01");
    }

    @Test
    void rebateReducesTotalWithoutTouchingPrincipal() {
        SettlementCalculator.SettlementQuote quote =
                calculator.quote(new BigDecimal("1000.00"), new BigDecimal("10.00"), new BigDecimal("0.0100"));
        assertThat(quote.settlementTotal()).isEqualByComparingTo("1000.00");
        assertThat(quote.remainingPrincipal()).isEqualByComparingTo("1000.00");
    }

    @Test
    void negativeRemainingIsRejected() {
        assertThatThrownBy(() -> calculator.quote(new BigDecimal("-0.01"), BigDecimal.ZERO,
                new BigDecimal("0.0100"))).isInstanceOf(IllegalArgumentException.class);
    }
}
