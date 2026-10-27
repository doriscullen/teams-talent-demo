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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.math.BigDecimal;
import java.time.LocalDateTime;
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
 * 提前结清（US-005 / AC-16 / BR-INS-12/14）：
 * 同键重放 200 首次结果；新键对已结清计划 409；ledger 失败保持 ACTIVE 且不还款。
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

        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        when(clock.today()).thenReturn(NOW.toLocalDate());

        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));
        when(intentRepository.saveAndFlush(any(SettlementIntent.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        service = new SettlementService(planRepository, policyRepository, intentRepository,
                new SettlementCalculator(), ledgerPort, accountPort, auditPort, notificationPort,
                accessGuard, clock, txManager);
    }

    @Test
    void settlesActivePlanOnceWithPenaltyAndSingleRepayment() {
        SettlementService.SettlementResult result = service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-1", BigDecimal.ZERO));

        assertThat(result.replayed()).isFalse();
        assertThat(result.quote().penaltyFee()).isEqualByComparingTo("6.00");
        assertThat(result.quote().feeRebate()).isEqualByComparingTo("0.00");
        assertThat(result.quote().settlementTotal()).isEqualByComparingTo("606.00");
        assertThat(plan.getStatus().name()).isEqualTo("SETTLED");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("0.00");
        verify(accountPort).applyRepayment(ACCOUNT, new BigDecimal("600.00"));
        verify(ledgerPort).postGroup(eq("settle-1"), eq("INSTALLMENT_SETTLEMENT"), eq(PLAN_ID), any());
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_SETTLED"), anyString(), eq(PLAN_ID), anyString());
    }

    @Test
    void sameSettlementKeyReplaysCompletedResultWithoutSecondRepayment() {
        SettlementIntent completed = mock(SettlementIntent.class);
        when(completed.getPlanId()).thenReturn(PLAN_ID);
        when(completed.isCompleted()).thenReturn(true);
        when(completed.getPrincipal()).thenReturn(new BigDecimal("600.00"));
        when(completed.getPenaltyFee()).thenReturn(new BigDecimal("6.00"));
        when(completed.getFeeRebate()).thenReturn(new BigDecimal("0.00"));
        when(completed.getAmount()).thenReturn(new BigDecimal("606.00"));
        when(intentRepository.findById("settle-1")).thenReturn(Optional.of(completed));

        SettlementService.SettlementResult result = service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-1", BigDecimal.ZERO));

        assertThat(result.replayed()).isTrue();
        assertThat(result.quote().settlementTotal()).isEqualByComparingTo("606.00");
        verify(accountPort, never()).applyRepayment(anyString(), any());
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
    }

    @Test
    void newKeyOnSettledPlanIsRejected() {
        plan.settle("settle-1", NOW.minusHours(1));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-2", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("SETTLEMENT_NOT_ALLOWED");
        verify(accountPort, never()).applyRepayment(anyString(), any());
    }

    @Test
    void keyReusedByAnotherPlanIsRejected() {
        SettlementIntent other = mock(SettlementIntent.class);
        when(other.getPlanId()).thenReturn("IP9999");
        when(intentRepository.findById("settle-1")).thenReturn(Optional.of(other));

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-1", BigDecimal.ZERO)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void ledgerFailureLeavesPlanActiveAndSkipsRepayment() {
        doThrow(new RemoteServiceException("ledger-service", "down"))
                .when(ledgerPort).postGroup(anyString(), anyString(), anyString(), any());

        assertThatThrownBy(() -> service.settle(CUSTOMER,
                new SettlementService.SettlementCommand(PLAN_ID, "settle-3", BigDecimal.ZERO)))
                .isInstanceOf(RemoteServiceException.class);

        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("600.00");
        verify(accountPort, never()).applyRepayment(anyString(), any());
        verify(planRepository, times(0)).saveAndFlush(any());
    }
}
