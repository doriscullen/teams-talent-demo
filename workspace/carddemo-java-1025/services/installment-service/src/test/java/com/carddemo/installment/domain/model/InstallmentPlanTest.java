package com.carddemo.installment.domain.model;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 计划状态机与本金账务语义（PRD §14、BR-INS-05/10/12）。 */
class InstallmentPlanTest {

    private InstallmentPlan plan() {
        return new InstallmentPlan("IP0001", "00000000006", null, SourceType.TRANSACTION,
                "0000000000000200", new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                new BigDecimal("19.25"), "key-1", LocalDateTime.of(2026, 10, 27, 10, 0));
    }

    @Test
    void newPlanIsActiveAndOccupiesFullPrincipal() {
        InstallmentPlan plan = plan();
        assertThat(plan.getStatus()).isEqualTo(PlanStatus.ACTIVE);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("1000.00");
        assertThat(plan.isActive()).isTrue();
    }

    @Test
    void settlementZeroesPrincipalOnceAndRecordsKey() {
        InstallmentPlan plan = plan();
        plan.settle("settle-1", LocalDateTime.of(2026, 10, 28, 9, 0));

        assertThat(plan.getStatus()).isEqualTo(PlanStatus.SETTLED);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("0.00");
        assertThat(plan.getSettlementIdempotencyKey()).isEqualTo("settle-1");
        assertThat(plan.isActive()).isFalse();
    }

    @Test
    void repaymentReducesRemainingPrincipalWithoutExtraRelease() {
        InstallmentPlan plan = plan();
        plan.repayPrincipal(new BigDecimal("400.00"));
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThatThrownBy(() -> plan.repayPrincipal(new BigDecimal("600.01")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> plan.repayPrincipal(BigDecimal.ZERO))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void cancelOnlyFromActiveState() {
        InstallmentPlan plan = plan();
        plan.cancel();
        assertThat(plan.getStatus()).isEqualTo(PlanStatus.CANCELLED);
        assertThatThrownBy(plan::cancel).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(plan::requireActive).isInstanceOf(IllegalStateException.class);
    }
}
