package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.model.AccountLockRow;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRate;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.AccountLockRepository;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.InstallmentRateRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import com.carddemo.installment.domain.service.EligibilityPolicy;
import com.carddemo.installment.domain.service.FeeScheduleCalculator;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import com.carddemo.installment.infrastructure.security.PreviewTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.LocalDate;
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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 提交分期用例（REQ-INS-04 / BR-INS-04/09/10/11/14/15、US-001/002/003/007）。
 * 单测全部 Mock 外部依赖（DB/HTTP），只验证业务编排与幂等/上限/失败回滚契约。
 */
class InstallmentApplicationServiceTest {

    private static final String ACCOUNT = "00000000006";
    private static final String TXN = "0000000000000200";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private InstallmentPolicyRepository policyRepository;
    private InstallmentRateRepository rateRepository;
    private InstallmentPlanRepository planRepository;
    private InstallmentScheduleRepository scheduleRepository;
    private PrincipalAllocationRepository allocationRepository;
    private EligibilityFlagRepository flagRepository;
    private AccountLockRepository lockRepository;
    private AccountPort accountPort;
    private TransactionPort transactionPort;
    private BillingPort billingPort;
    private LedgerPort ledgerPort;
    private AuditPort auditPort;
    private NotificationPort notificationPort;
    private AccessGuard accessGuard;
    private PreviewTokenService previewTokens;
    private InstallmentApplicationService service;

    @BeforeEach
    void setUp() {
        policyRepository = mock(InstallmentPolicyRepository.class);
        rateRepository = mock(InstallmentRateRepository.class);
        planRepository = mock(InstallmentPlanRepository.class);
        scheduleRepository = mock(InstallmentScheduleRepository.class);
        allocationRepository = mock(PrincipalAllocationRepository.class);
        flagRepository = mock(EligibilityFlagRepository.class);
        lockRepository = mock(AccountLockRepository.class);
        accountPort = mock(AccountPort.class);
        transactionPort = mock(TransactionPort.class);
        billingPort = mock(BillingPort.class);
        ledgerPort = mock(LedgerPort.class);
        auditPort = mock(AuditPort.class);
        notificationPort = mock(NotificationPort.class);
        accessGuard = mock(AccessGuard.class);
        previewTokens = new PreviewTokenService("preview-secret", 30);

        InstallmentPolicy policy = mock(InstallmentPolicy.class);
        when(policy.getMinTransactionAmount()).thenReturn(new BigDecimal("100.00"));
        when(policy.getMinBillAmount()).thenReturn(new BigDecimal("500.00"));
        when(policy.getMaxActivePlansPerAccount()).thenReturn(20);
        when(policy.getPenaltyRate()).thenReturn(new BigDecimal("0.0100"));
        when(policyRepository.findById((short) 1)).thenReturn(Optional.of(policy));

        InstallmentRate rate = mock(InstallmentRate.class);
        when(rate.getMonthlyFeeRate()).thenReturn(new BigDecimal("0.0055"));
        when(rateRepository.findById(6)).thenReturn(Optional.of(rate));

        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        when(clock.today()).thenReturn(NOW.toLocalDate());

        when(lockRepository.lockByAccountId(ACCOUNT)).thenReturn(Optional.of(mock(AccountLockRow.class)));
        when(accountPort.getAccount(ACCOUNT)).thenReturn(
                new AccountPort.AccountSnapshot(ACCOUNT, "Y", new BigDecimal("2450.75"),
                        new BigDecimal("20000.00"), LocalDate.of(2018, 3, 9)));
        when(transactionPort.findTransaction(TXN)).thenReturn(Optional.of(new TransactionPort.TransactionView(
                TXN, ACCOUNT, "3344556677889900", "01", "0001", "Purchase", new BigDecimal("1000.00"),
                NOW.minusDays(1), "POSTED")));

        service = new InstallmentApplicationService(policyRepository, rateRepository, planRepository,
                scheduleRepository, allocationRepository, flagRepository, lockRepository, accountPort,
                transactionPort, billingPort, ledgerPort, auditPort, notificationPort,
                new EligibilityPolicy(), new FeeScheduleCalculator(), previewTokens, accessGuard, clock);
    }

    private String token(BigDecimal principal) {
        return previewTokens.issue(new PreviewTokenService.PreviewPayload(ACCOUNT, SourceType.TRANSACTION,
                TXN, principal, 6, new BigDecimal("0.0055"), NOW));
    }

    private InstallmentApplicationService.CreateCommand command(String idempotencyKey, BigDecimal principal) {
        return new InstallmentApplicationService.CreateCommand(ACCOUNT, SourceType.TRANSACTION, TXN, principal,
                6, token(principal), true, idempotencyKey);
    }

    @Test
    void createsActivePlanWithSixSchedulesAndFeeIncomePosting() {
        InstallmentApplicationService.CreateResult result = service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isFalse();
        ArgumentCaptor<InstallmentPlan> planCaptor = ArgumentCaptor.forClass(InstallmentPlan.class);
        verify(planRepository).save(planCaptor.capture());
        InstallmentPlan plan = planCaptor.getValue();
        assertThat(plan.getPrincipal()).isEqualByComparingTo("1000.00");
        assertThat(plan.getTotalFee()).isEqualByComparingTo("19.25");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("1000.00");
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<InstallmentSchedule>> scheduleCaptor = ArgumentCaptor.forClass(List.class);
        verify(scheduleRepository).saveAll(scheduleCaptor.capture());
        assertThat(scheduleCaptor.getValue()).hasSize(6);
        assertThat(scheduleCaptor.getValue().get(0).getDueDate()).isEqualTo(LocalDate.of(2026, 11, 9));
        assertThat(scheduleCaptor.getValue().get(5).getDueDate()).isEqualTo(LocalDate.of(2027, 4, 9));
        assertThat(scheduleCaptor.getValue().get(5).getPrincipalDue()).isEqualByComparingTo("166.70");

        verify(ledgerPort).postGroup(eq(plan.getPlanId()), eq("INSTALLMENT_CREATE"), eq(plan.getPlanId()), any());
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_CREATED"), anyString(), anyString(), anyString());
        verify(notificationPort).enqueue(anyString(), eq(ACCOUNT), eq("INSTALLMENT_CREATED"), anyString());
    }

    @Test
    void sameIdempotencyKeyReplaysFirstPlanWithoutSecondPosting() {
        InstallmentPlan existing = mock(InstallmentPlan.class);
        when(existing.getAccountId()).thenReturn(ACCOUNT);
        when(planRepository.findByIdempotencyKey("key-1")).thenReturn(Optional.of(existing));

        InstallmentApplicationService.CreateResult result = service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isTrue();
        assertThat(result.plan()).isSameAs(existing);
        verify(planRepository, never()).save(any());
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
    }

    @Test
    void sameKeyFromAnotherAccountIsRejected() {
        InstallmentPlan existing = mock(InstallmentPlan.class);
        when(existing.getAccountId()).thenReturn("00000000005");
        when(planRepository.findByIdempotencyKey("key-1")).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void tamperedPreviewTokenIsRejectedBeforeAnyWrite() {
        InstallmentApplicationService.CreateCommand tampered = new InstallmentApplicationService.CreateCommand(
                ACCOUNT, SourceType.TRANSACTION, TXN, new BigDecimal("1000.00"), 6,
                token(new BigDecimal("900.00")), true, "key-2");

        assertThatThrownBy(() -> service.create(CUSTOMER, tampered))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PREVIEW_EXPIRED");
        verify(planRepository, never()).save(any());
    }

    @Test
    void agreementIsRequired() {
        InstallmentApplicationService.CreateCommand noAgreement = new InstallmentApplicationService.CreateCommand(
                ACCOUNT, SourceType.TRANSACTION, TXN, new BigDecimal("1000.00"), 6,
                token(new BigDecimal("1000.00")), false, "key-3");

        assertThatThrownBy(() -> service.create(CUSTOMER, noAgreement))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("AGREEMENT_REQUIRED");
    }

    @Test
    void twentyActivePlansRejectsTwentyFirst() {
        when(planRepository.countByAccountIdAndStatus(ACCOUNT,
                com.carddemo.installment.domain.model.PlanStatus.ACTIVE)).thenReturn(20L);

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-4", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_LIMIT_EXCEEDED");
        verify(planRepository, never()).save(any());
    }

    @Test
    void alreadyInstalledTransactionIsRejected() {
        when(allocationRepository.existsByTransactionId(TXN)).thenReturn(true);

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-5", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("ALREADY_INSTALLED");
    }

    @Test
    void principalAboveTransactionAmountIsRejected() {
        InstallmentApplicationService.CreateCommand tooLarge = new InstallmentApplicationService.CreateCommand(
                ACCOUNT, SourceType.TRANSACTION, TXN, new BigDecimal("1000.01"), 6,
                token(new BigDecimal("1000.01")), true, "key-6");

        assertThatThrownBy(() -> service.create(CUSTOMER, tooLarge))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PRINCIPAL_EXCEEDS_LIMIT");
    }

    @Test
    void ledgerFailurePropagatesSoTransactionRollsBack() {
        doThrow(new RemoteServiceException("ledger-service", "ledger down"))
                .when(ledgerPort).postGroup(anyString(), anyString(), anyString(), any());

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-7", new BigDecimal("1000.00"))))
                .isInstanceOf(RemoteServiceException.class);
        verify(auditPort, never()).record(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void billPlanAllocatesAcrossUninstalledTransactions() {
        InstallmentRate rate3 = mock(InstallmentRate.class);
        when(rate3.getMonthlyFeeRate()).thenReturn(new BigDecimal("0.0060"));
        when(rateRepository.findById(3)).thenReturn(Optional.of(rate3));

        when(transactionPort.findTransaction(TXN)).thenReturn(Optional.empty());
        when(billingPort.currentStatement(ACCOUNT)).thenReturn(new BillingPort.BillingStatement(
                "BILL20261000000000006", ACCOUNT, LocalDate.of(2026, 9, 9), LocalDate.of(2026, 10, 27),
                new BigDecimal("1500.00"), new BigDecimal("1000.00"),
                List.of(new BillingPort.BillingLine("0000000000000005", new BigDecimal("1500.00"),
                        LocalDate.of(2026, 10, 1), "Purchase"))));
        when(allocationRepository.findByTransactionIdIn(any())).thenReturn(List.of());

        InstallmentApplicationService.CreateCommand bill = new InstallmentApplicationService.CreateCommand(
                ACCOUNT, SourceType.BILL, "BILL20261000000000006", new BigDecimal("1000.00"), 3,
                previewTokens.issue(new PreviewTokenService.PreviewPayload(ACCOUNT, SourceType.BILL,
                        "BILL20261000000000006", new BigDecimal("1000.00"), 3, new BigDecimal("0.0060"), NOW)),
                true, "key-8");

        service.create(CUSTOMER, bill);

        verify(ledgerPort).postGroup(anyString(), eq("INSTALLMENT_CREATE"), anyString(), any());
        verify(planRepository).save(any(InstallmentPlan.class));
    }
}
