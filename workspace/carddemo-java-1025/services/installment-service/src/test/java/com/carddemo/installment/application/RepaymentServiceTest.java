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
import com.carddemo.installment.domain.model.SettlementIntent;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.domain.repository.SettlementIntentRepository;
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
 * 一期还款（A-003 / US-005，A-R002/A-R003/A-R004）：
 * 仅完整期次本金可还，任何其它金额在任何远端资金动作前拒绝；
 * 账户作用ID按操作+计划生成且与结清命名空间分离；在途结清阻止还款；失败可续跑。
 */
class RepaymentServiceTest {

    private static final String PLAN_ID = "IP0001";
    private static final String ACCOUNT = "00000000006";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private InstallmentPlanRepository planRepository;
    private InstallmentScheduleRepository scheduleRepository;
    private InstallmentRepaymentRepository repaymentRepository;
    private SettlementIntentRepository settlementIntentRepository;
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
        settlementIntentRepository = mock(SettlementIntentRepository.class);
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

        service = new RepaymentService(planRepository, scheduleRepository, repaymentRepository,
                settlementIntentRepository, accountPort, ledgerPort, mock(AuditPort.class),
                mock(NotificationPort.class), mock(AccessGuard.class), clock, txManager);
    }

    private RepaymentService.RepaymentCommand command(String key, String amount) {
        return new RepaymentService.RepaymentCommand(PLAN_ID, key, new BigDecimal(amount));
    }

    @Test
    void firstPeriodRepaymentReducesRemainingAndMarksSchedulePaid() {
        RepaymentService.RepaymentResult result = service.repay(CUSTOMER, command("pay-1", "300.00"));

        assertThat(result.replayed()).isFalse();
        assertThat(result.paidInstallments()).isEqualTo(1);
        assertThat(result.principalApplied()).isEqualByComparingTo("300.00");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(schedules.get(0).getStatus().name()).isEqualTo("PAID");
        verify(accountPort).applyRepayment(eq(ACCOUNT), eq(new BigDecimal("300.00")),
                eq("REPAY-" + hashOf("REPAY|" + PLAN_ID + "|pay-1")));
        verify(ledgerPort).postGroup(anyString(), eq("INSTALLMENT_REPAYMENT"), eq(PLAN_ID), any());
    }

    @Test
    void partialAmountIsRejectedBeforeAnyMoneyMoves() {
        for (String amount : List.of("100.00", "350.00", "299.99")) {
            assertThatThrownBy(() -> service.repay(CUSTOMER, command("partial-" + amount, amount)))
                    .isInstanceOf(BusinessRuleException.class)
                    .extracting(ex -> ((BusinessRuleException) ex).getCode())
                    .isEqualTo("UNSUPPORTED_REPAYMENT_AMOUNT");
        }
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("900.00");
    }

    @Test
    void eachPeriodAmountFollowsScheduleSoEveryCentIsWrittenBack() {
        service.repay(CUSTOMER, command("pay-1", "300.00"));
        service.repay(CUSTOMER, command("pay-2", "300.00"));
        service.repay(CUSTOMER, command("pay-3", "300.00"));

        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("0.00");
        assertThat(schedules).allMatch(schedule -> schedule.getStatus().name().equals("PAID"));
        assertThat(repayments.values()).allMatch(InstallmentRepayment::isCompleted);
    }

    @Test
    void repaymentIsRejectedWhileSettlementIsInFlight() {
        when(settlementIntentRepository.findFirstByPlanIdAndStatusIn(eq(PLAN_ID), any()))
                .thenReturn(Optional.of(new SettlementIntent("settle-x", PLAN_ID, new BigDecimal("600.00"),
                        new BigDecimal("6.00"), BigDecimal.ZERO.setScale(2), new BigDecimal("606.00"), NOW)));

        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-9", "300.00")))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("SETTLEMENT_IN_PROGRESS");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void samePaymentKeyReplaysWithoutSecondFinancialEffect() {
        service.repay(CUSTOMER, command("pay-1", "300.00"));
        RepaymentService.RepaymentResult replay = service.repay(CUSTOMER, command("pay-1", "300.00"));

        assertThat(replay.replayed()).isTrue();
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        verify(accountPort, org.mockito.Mockito.times(1))
                .applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void paymentKeyReusedWithDifferentAmountIsRejected() {
        service.repay(CUSTOMER, command("pay-1", "300.00"));

        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-1", "200.00")))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void settledPlanRejectsRepayment() {
        plan.settle("settle-1", NOW.minusMinutes(5));

        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-3", "300.00")))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("REPAYMENT_NOT_ALLOWED");
    }

    @Test
    void accountFailureLeavesRepaymentPendingAndResumable() {
        when(accountPort.applyRepayment(anyString(), any(), anyString()))
                .thenThrow(new RemoteServiceException("account-service", "timeout"))
                .thenReturn(new BigDecimal("864.00"));

        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-4", "300.00")))
                .isInstanceOf(RemoteServiceException.class);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("900.00");
        assertThat(repayments.get("pay-4").getStatus()).isEqualTo(InstallmentRepayment.PENDING);

        RepaymentService.RepaymentResult resumed = service.repay(CUSTOMER, command("pay-4", "300.00"));

        assertThat(resumed.principalApplied()).isEqualByComparingTo("300.00");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(schedules.get(0).getStatus().name()).isEqualTo("PAID");
    }

    @Test
    void accountBusinessRejectionMarksFailedWithoutMovingMoney() {
        when(accountPort.applyRepayment(anyString(), any(), anyString()))
                .thenThrow(new BusinessRuleException("REPAYMENT_REJECTED", "insufficient balance"));

        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-5", "300.00")))
                .isInstanceOf(BusinessRuleException.class);
        assertThat(repayments.get("pay-5").getStatus()).isEqualTo(InstallmentRepayment.FAILED);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("900.00");
    }

    @Test
    void reconciliationCompletesInterruptedRepayment() {
        when(accountPort.applyRepayment(anyString(), any(), anyString()))
                .thenThrow(new RemoteServiceException("account-service", "timeout"))
                .thenReturn(new BigDecimal("864.00"));
        assertThatThrownBy(() -> service.repay(CUSTOMER, command("pay-6", "300.00")))
                .isInstanceOf(RemoteServiceException.class);

        InstallmentRepayment pending = repayments.get("pay-6");
        when(repaymentRepository.findByStatusInAndUpdatedAtBefore(any(), any())).thenReturn(List.of(pending));

        int completed = service.reconcilePending();

        assertThat(completed).isEqualTo(1);
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        assertThat(pending.getStatus()).isEqualTo(InstallmentRepayment.COMPLETED);
    }

    @Test
    void repaymentEffectIdDiffersFromSettlementEffectForSameClientKey() {
        String repaymentEffect = com.carddemo.installment.domain.service.EffectIds.repayment(PLAN_ID, "final");
        String settlementEffect = com.carddemo.installment.domain.service.EffectIds.settlement(PLAN_ID, "final");

        assertThat(repaymentEffect).isNotEqualTo(settlementEffect);
        assertThat(repaymentEffect).startsWith("REPAY-");
        assertThat(settlementEffect).startsWith("SETTLE-");
        assertThat(com.carddemo.installment.domain.service.EffectIds.repayment(PLAN_ID, "final"))
                .isEqualTo(repaymentEffect);
    }

    private static String hashOf(String material) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(material.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.substring(0, 40);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
