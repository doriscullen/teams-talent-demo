package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentRepayment;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 一期还款（A-003 / US-005）：真实还款减少剩余本金并推进还款计划；
 * paymentKey 幂等、账户端 effectId 去重、非 ACTIVE/超额被拒。
 */
class RepaymentServiceTest {

    private static final String PLAN_ID = "IP0001";
    private static final String ACCOUNT = "00000000006";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private InstallmentPlanRepository planRepository;
    private InstallmentScheduleRepository scheduleRepository;
    private InstallmentRepaymentRepository repaymentRepository;
    private AccountPort accountPort;
    private LedgerPort ledgerPort;
    private RepaymentService service;
    private InstallmentPlan plan;
    private final List<InstallmentSchedule> schedules = new ArrayList<>();
    private final Map<String, InstallmentRepayment> repayments = new HashMap<>();

    @BeforeEach
    void setUp() {
        planRepository = mock(InstallmentPlanRepository.class);
        scheduleRepository = mock(InstallmentScheduleRepository.class);
        repaymentRepository = mock(InstallmentRepaymentRepository.class);
        accountPort = mock(AccountPort.class);
        ledgerPort = mock(LedgerPort.class);

        plan = new InstallmentPlan(PLAN_ID, ACCOUNT, null, SourceType.TRANSACTION, "0000000000000200",
                new BigDecimal("900.00"), 3, new BigDecimal("0.0060"), new BigDecimal("10.80"),
                "key-1", NOW.minusDays(1));
        when(planRepository.findById(PLAN_ID)).thenReturn(Optional.of(plan));
        when(planRepository.findForUpdate(PLAN_ID)).thenReturn(Optional.of(plan));

        schedules.clear();
        for (int no = 1; no <= 3; no++) {
            schedules.add(new InstallmentSchedule(PLAN_ID + "-0" + no, PLAN_ID, no,
                    LocalDate.of(2026, 10, 9).plusMonths(no), new BigDecimal("300.00"),
                    new BigDecimal("3.60")));
        }
        when(scheduleRepository.findByPlanIdOrderByInstallmentNo(PLAN_ID)).thenReturn(schedules);

        repayments.clear();
        when(repaymentRepository.saveAndFlush(any(InstallmentRepayment.class))).thenAnswer(invocation -> {
            InstallmentRepayment repayment = invocation.getArgument(0);
            repayments.put(repayment.getPaymentKey(), repayment);
            return repayment;
        });
        when(repaymentRepository.findById(anyString())).thenAnswer(invocation ->
                Optional.ofNullable(repayments.get(invocation.getArgument(0))));

        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        when(clock.today()).thenReturn(NOW.toLocalDate());

        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        service = new RepaymentService(planRepository, scheduleRepository, repaymentRepository, accountPort,
                ledgerPort, mock(AuditPort.class), mock(NotificationPort.class), mock(AccessGuard.class),
                clock, txManager);
    }

    @Test
    void firstPeriodRepaymentReducesRemainingAndMarksSchedulePaid() {
        RepaymentService.RepaymentResult result = service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-1", new BigDecimal("300.00")));

        assertThat(result.replayed()).isFalse();
        assertThat(result.paidInstallments()).isEqualTo(1);
        assertThat(result.principalApplied()).isEqualByComparingTo("300.00");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(schedules.get(0).getStatus().name()).isEqualTo("PAID");
        assertThat(schedules.get(1).getStatus().name()).isEqualTo("PENDING");

        verify(accountPort).applyRepayment(ACCOUNT, new BigDecimal("300.00"), "pay-1");
        verify(ledgerPort).postGroup(eq("REPAY-pay-1"), eq("INSTALLMENT_REPAYMENT"), eq(PLAN_ID), any());
    }

    @Test
    void samePaymentKeyReplaysWithoutSecondFinancialEffect() {
        service.repay(CUSTOMER, new RepaymentService.RepaymentCommand(PLAN_ID, "pay-1", new BigDecimal("300.00")));
        RepaymentService.RepaymentResult replay = service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-1", new BigDecimal("300.00")));

        assertThat(replay.replayed()).isTrue();
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        verify(accountPort, org.mockito.Mockito.times(1))
                .applyRepayment(ACCOUNT, new BigDecimal("300.00"), "pay-1");
        verify(ledgerPort, org.mockito.Mockito.times(1))
                .postGroup(eq("REPAY-pay-1"), anyString(), anyString(), any());
    }

    @Test
    void paymentKeyReusedWithDifferentAmountIsRejected() {
        service.repay(CUSTOMER, new RepaymentService.RepaymentCommand(PLAN_ID, "pay-1", new BigDecimal("300.00")));

        assertThatThrownBy(() -> service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-1", new BigDecimal("200.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void repaymentAboveRemainingPrincipalIsRejected() {
        assertThatThrownBy(() -> service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-2", new BigDecimal("900.01"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("REPAYMENT_EXCEEDS_PRINCIPAL");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void settledPlanRejectsRepayment() {
        plan.settle("settle-1", NOW.minusMinutes(5));

        assertThatThrownBy(() -> service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-3", new BigDecimal("100.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("REPAYMENT_NOT_ALLOWED");
    }

    @Test
    void accountFailureLeavesRepaymentResumableAndDoesNotTouchPlan() {
        when(accountPort.applyRepayment(ACCOUNT, new BigDecimal("300.00"), "pay-4"))
                .thenThrow(new RemoteServiceException("account-service", "timeout"))
                .thenReturn(new BigDecimal("1844.75"));

        assertThatThrownBy(() -> service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-4", new BigDecimal("300.00"))))
                .isInstanceOf(RemoteServiceException.class);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("900.00");
        assertThat(repayments.get("pay-4").getStatus()).isEqualTo(InstallmentRepayment.FAILED);

        RepaymentService.RepaymentResult resumed = service.repay(CUSTOMER,
                new RepaymentService.RepaymentCommand(PLAN_ID, "pay-4", new BigDecimal("300.00")));

        assertThat(resumed.principalApplied()).isEqualByComparingTo("300.00");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(schedules.get(0).getStatus().name()).isEqualTo("PAID");
    }
}
