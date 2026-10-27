package com.carddemo.installment.domain.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * BR-INS-03 / BR-INS-03R / test-profile-v2：期初剩余本金计费 + 末期吸收尾差。
 * 期望值来自独立数学推导（1000/6=19.25、500/3=6.00、900/3=10.80、100/12=3.26）。
 */
class FeeScheduleCalculatorTest {

    private final FeeScheduleCalculator calculator = new FeeScheduleCalculator();

    @Test
    void sixPeriodsUseOpeningRemainingPrincipalFees() {
        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"));

        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::principal)
                .containsExactly(new BigDecimal("166.66"), new BigDecimal("166.66"), new BigDecimal("166.66"),
                        new BigDecimal("166.66"), new BigDecimal("166.66"), new BigDecimal("166.70"));
        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::fee)
                .containsExactly(new BigDecimal("5.50"), new BigDecimal("4.58"), new BigDecimal("3.67"),
                        new BigDecimal("2.75"), new BigDecimal("1.83"), new BigDecimal("0.92"));
        assertThat(schedule.totalFee()).isEqualByComparingTo("19.25");
        assertThat(schedule.firstPeriodTotal()).isEqualByComparingTo("172.16");
        assertThat(schedule.totalPrincipal()).isEqualByComparingTo("1000.00");
    }

    @Test
    void threePeriodsMatchProfileValues() {
        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(new BigDecimal("500.00"), 3, new BigDecimal("0.0060"));

        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::principal)
                .containsExactly(new BigDecimal("166.66"), new BigDecimal("166.66"), new BigDecimal("166.68"));
        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::fee)
                .containsExactly(new BigDecimal("3.00"), new BigDecimal("2.00"), new BigDecimal("1.00"));
        assertThat(schedule.totalFee()).isEqualByComparingTo("6.00");
        assertThat(schedule.firstPeriodTotal()).isEqualByComparingTo("169.66");
    }

    @Test
    void twelvePeriodsAbsorbTailIntoLastInstallment() {
        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(new BigDecimal("100.00"), 12, new BigDecimal("0.0050"));

        assertThat(schedule.periods()).hasSize(12);
        assertThat(schedule.periods().get(11).principal()).isEqualByComparingTo("8.37");
        assertThat(schedule.totalPrincipal()).isEqualByComparingTo("100.00");
        assertThat(schedule.totalFee()).isEqualByComparingTo("3.26");
        assertThat(schedule.firstPeriodTotal()).isEqualByComparingTo("8.83");
    }

    @Test
    void originalUs005PlanFeesAreDerivedFromRemainingPrincipal() {
        FeeScheduleCalculator.FeeSchedule schedule =
                calculator.calculate(new BigDecimal("900.00"), 3, new BigDecimal("0.0060"));

        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::principal)
                .containsExactly(new BigDecimal("300.00"), new BigDecimal("300.00"), new BigDecimal("300.00"));
        assertThat(schedule.periods()).extracting(FeeScheduleCalculator.Period::fee)
                .containsExactly(new BigDecimal("5.40"), new BigDecimal("3.60"), new BigDecimal("1.80"));
        assertThat(schedule.totalFee()).isEqualByComparingTo("10.80");
        assertThat(schedule.firstPeriodTotal()).isEqualByComparingTo("305.40");
    }

    @Test
    void scheduleTotalsAlwaysEqualPrincipalAndTwoDecimals() {
        List<BigDecimal> principals = List.of(new BigDecimal("100.00"), new BigDecimal("1000.00"),
                new BigDecimal("999.99"), new BigDecimal("1234.56"), new BigDecimal("0.03"));
        for (BigDecimal principal : principals) {
            for (int term : List.of(3, 6, 12)) {
                FeeScheduleCalculator.FeeSchedule schedule =
                        calculator.calculate(principal, term, new BigDecimal("0.0055"));
                BigDecimal sum = schedule.periods().stream()
                        .map(FeeScheduleCalculator.Period::principal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                assertThat(sum).as("principal %s term %s", principal, term).isEqualByComparingTo(principal);
                schedule.periods().forEach(period -> {
                    assertThat(period.principal().scale()).isEqualTo(2);
                    assertThat(period.fee().scale()).isEqualTo(2);
                });
            }
        }
    }

    @Test
    void rejectsInvalidArguments() {
        assertThatThrownBy(() -> calculator.calculate(BigDecimal.ZERO, 3, new BigDecimal("0.0060")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> calculator.calculate(new BigDecimal("100.00"), 0, new BigDecimal("0.0060")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> calculator.calculate(new BigDecimal("100.00"), 3, new BigDecimal("-0.0001")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
