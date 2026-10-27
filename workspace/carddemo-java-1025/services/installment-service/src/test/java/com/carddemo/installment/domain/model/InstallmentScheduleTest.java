package com.carddemo.installment.domain.model;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 还款计划行（A-R002）：按实际归还本金累计，达到应还本金才置 PAID。 */
class InstallmentScheduleTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);

    private InstallmentSchedule schedule() {
        return new InstallmentSchedule("IP1-01", "IP1", 1, LocalDate.of(2026, 11, 9),
                new BigDecimal("300.00"), new BigDecimal("3.60"));
    }

    @Test
    void partialPrincipalIsAccumulatedWithoutMarkingPaid() {
        InstallmentSchedule schedule = schedule();

        schedule.applyPrincipal(new BigDecimal("100.00"), NOW);

        assertThat(schedule.getPaidPrincipal()).isEqualByComparingTo("100.00");
        assertThat(schedule.unpaidPrincipal()).isEqualByComparingTo("200.00");
        assertThat(schedule.getStatus()).isEqualTo(ScheduleStatus.PENDING);
        assertThat(schedule.getPaidAt()).isNull();
    }

    @Test
    void cumulativePrincipalMarksPaidExactlyWhenFullyRepaid() {
        InstallmentSchedule schedule = schedule();

        schedule.applyPrincipal(new BigDecimal("100.00"), NOW);
        schedule.applyPrincipal(new BigDecimal("200.00"), NOW.plusMinutes(1));

        assertThat(schedule.getPaidPrincipal()).isEqualByComparingTo("300.00");
        assertThat(schedule.getStatus()).isEqualTo(ScheduleStatus.PAID);
        assertThat(schedule.getPaidAt()).isEqualTo(NOW.plusMinutes(1));
        assertThat(schedule.unpaidPrincipal()).isEqualByComparingTo("0.00");
    }

    @Test
    void repaymentBeyondPeriodPrincipalIsRejected() {
        InstallmentSchedule schedule = schedule();
        schedule.applyPrincipal(new BigDecimal("250.00"), NOW);

        assertThatThrownBy(() -> schedule.applyPrincipal(new BigDecimal("50.01"), NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("exceeds the period principal");
    }

    @Test
    void paidScheduleRejectsFurtherPrincipal() {
        InstallmentSchedule schedule = schedule();
        schedule.applyPrincipal(new BigDecimal("300.00"), NOW);

        assertThatThrownBy(() -> schedule.applyPrincipal(new BigDecimal("1.00"), NOW))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already paid");
    }
}
