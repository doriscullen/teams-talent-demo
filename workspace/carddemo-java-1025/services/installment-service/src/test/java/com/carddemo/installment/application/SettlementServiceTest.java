package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.SettlementIntent;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.SettlementIntentRepository;
import com.carddemo.installment.domain.service.SettlementCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 提前结清（US-005 / AC-16 / BR-INS-12/14，A-001/A-005/A-006）：
 * 同键重放返回首次结果；新键对非 ACTIVE 409；在途意图互斥；服务端减免固定 0；分录借贷平衡；
 * ledger/账户失败保持可续跑且不重复扣款。
 */
class SettlementServiceTest {

    private static final String PLAN_ID = "IP0001";
    private static final String ACCOUNT = "00000000006";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private InstallmentPlanRepository planRepository;
    private SettlementIntentRepository intentRepository;
    private LedgerPort ledgerPort;
    private AccountPort accountPort;
    private AuditPort auditPort;
    private SettlementService service;
    private InstallmentPlan plan;

    @BeforeEach
    void setUp() {
        planRepository = mock(InstallmentPlanRepository.class);
        intentRepository = mock(SettlementIntentRepository.class);
        InstallmentPolicyRepository policyRepository = mock(InstallmentPolicyRepository.class);
        ledgerPort = mock(LedgerPort.class);
        accountPort = mock(AccountPort.class);
        auditPort = mock(AuditPort.class);
        NotificationPort notificationPort = mock(NotificationPort.class);
        AccessGuard accessGuard = mock(AccessGuard.class);

        InstallmentPolicy policy = mock(InstallmentPolicy.class);
        when(policy.getPenaltyRate()).thenReturn(new BigDecimal("0.0100"));
        when(policyRepository.findById((short) 1)).thenReturn(Optional.of(policy));

        plan = new InstallmentPlan(PLAN_ID, ACCOUNT, null, SourceType.TRANSACTION, "0000000000000200",
                new BigDecimal("900.00"), 3, new BigDecimal("0.0060"), new BigDecimal("10.80"),
                "key-1", NOW.minusDays(1));
        plan.repayPrincipal(new BigDecimal("300.00"));
        when(planRepository.findById(PLAN_ID)).thenReturn(Optional.of(plan));
        when(planRepository.findForUpdate(PLAN_ID)).thenReturn(Optional.of(plan));

        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        when(clock.today()).thenReturn(NOW.toLocalDate());

        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(intentRepository.saveAndFlush(any(SettlementIntent.class))).thenAnswer(invocation -> {
            lastSavedIntent = invocation.getArgument(0);
            return lastSavedIntent;
        });
        when(intentRepository.findById(anyString())).thenAnswer(invocation ->
                Optional.ofNullable(lastSavedIntent));

        service = new SettlementService(planRepository, policyRepository, intentRepository,
                new SettlementCalculator(), ledgerPort, accountPort, auditPort, notificationPort,
                accessGuard, clock, txManager);
    }

    private SettlementIntent lastSavedIntent;

    @Test
    void settlesActivePlanOnceWithPenaltyAndBalancedLedger() {
        SettlementService.SettlementResult result = service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-1", BigDecimal.ZERO));

        assertThat(result.replayed()).isFalse();
        assertThat(result.quote().penaltyFee()).isEqualByComparingTo("6.00");
        assertThat(result.quote().feeRebate()).isEqualByComparingTo("0.00");
        assertThat(result.quote().settlementTotal()).isEqualByComparingTo("606.00");
        assertThat(plan.getStatus().name()).isEqualTo("SETTLED");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("0.00");

        verify(accountPort).applyRepayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-settle-1");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LedgerPort.JournalLine>> captor = ArgumentCaptor.forClass(List.class);
        verify(ledgerPort).postGroup(eq("settle-1"), eq("INSTALLMENT_SETTLEMENT"), eq(PLAN_ID), captor.capture());
        BigDecimal debit = captor.getValue().stream().filter(line -> "DEBIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal credit = captor.getValue().stream().filter(line -> "CREDIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(debit).isEqualByComparingTo("606.00");
        assertThat(credit).isEqualByComparingTo("606.00");
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_SETTLED"), anyString(), eq(PLAN_ID), anyString());
    }

    @Test
    void sameSettlementKeyReplaysCompletedResultWithoutSecondRepayment() {
        SettlementIntent completed = new SettlementIntent("settle-1", PLAN_ID, new BigDecimal("600.00"),
                new BigDecimal("6.00"), BigDecimal.ZERO.setScale(2), new BigDecimal("606.00"), NOW);
        completed.markCompleted(NOW);
        when(intentRepository.findById("settle-1")).thenReturn(Optional.of(completed));

        SettlementService.SettlementResult result = service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-1", BigDecimal.ZERO));

        assertThat(result.replayed()).isTrue();
        assertThat(result.quote().settlementTotal()).isEqualByComparingTo("606.00");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
    }

    @Test
    void clientSuppliedFeeRebateIsRejected() {
        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-2", new BigDecimal("10000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INVALID_FEE_REBATE");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");
    }

    @Test
    void differentNewKeyOnSettledPlanIsRejected() {
        plan.settle("settle-1", NOW.minusMinutes(1));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-2", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("SETTLEMENT_NOT_ALLOWED");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void differentKeyWithInFlightIntentIsRejected() {
        SettlementIntent inflight = new SettlementIntent("settle-other", PLAN_ID, new BigDecimal("600.00"),
                new BigDecimal("6.00"), BigDecimal.ZERO.setScale(2), new BigDecimal("606.00"), NOW);
        when(intentRepository.findFirstByPlanIdAndStatusNot(PLAN_ID, SettlementIntent.COMPLETED))
                .thenReturn(Optional.of(inflight));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-2", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("CONCURRENT_SETTLEMENT");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void ledgerFailureKeepsPlanActiveAndSkipsPayment() {
        doThrow(new RemoteServiceException("ledger-service", "ledger down"))
                .when(ledgerPort).postGroup(anyString(), anyString(), anyString(), any());

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-3", BigDecimal.ZERO)))
                .isInstanceOf(RemoteServiceException.class);
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");
        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
    }

    @Test
    void lostPaymentResponseThenRetryKeepsSingleFinancialEffect() {
        when(accountPort.applyRepayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-settle-4"))
                .thenThrow(new RemoteServiceException("account-service", "timeout"))
                .thenReturn(new BigDecimal("1844.75"));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-4", BigDecimal.ZERO)))
                .isInstanceOf(RemoteServiceException.class);
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");

        SettlementService.SettlementResult result = service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-4", BigDecimal.ZERO));

        assertThat(result.replayed()).isFalse();
        assertThat(plan.getStatus().name()).isEqualTo("SETTLED");
        verify(accountPort, times(2)).applyRepayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-settle-4");
        verify(ledgerPort, times(2)).postGroup(eq("settle-4"), anyString(), anyString(), any());
    }

    @Test
    void accountBusinessRejectionReversesLedgerAndRequiresNewKey() {
        when(accountPort.applyRepayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-settle-5"))
                .thenThrow(new BusinessRuleException("REPAYMENT_REJECTED", "insufficient balance"));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-5", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("REPAYMENT_REJECTED");
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");
        verify(ledgerPort).postGroup(eq("settle-5-REV"), eq("INSTALLMENT_SETTLEMENT_REVERSAL"),
                eq(PLAN_ID), any());
        assertThat(lastSavedIntent.getStatus()).isEqualTo(SettlementIntent.FAILED);

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-5", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("SETTLEMENT_FAILED");
    }

    @Test
    void reversalGroupIsBalanced() {
        when(accountPort.applyRepayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-settle-6"))
                .thenThrow(new BusinessRuleException("REPAYMENT_REJECTED", "insufficient balance"));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-6", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LedgerPort.JournalLine>> captor = ArgumentCaptor.forClass(List.class);
        verify(ledgerPort).postGroup(eq("settle-6-REV"), anyString(), anyString(), captor.capture());
        BigDecimal debit = captor.getValue().stream().filter(line -> "DEBIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal credit = captor.getValue().stream().filter(line -> "CREDIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(debit).isEqualByComparingTo(credit);
        assertThat(debit).isEqualByComparingTo("606.00");
    }
}
