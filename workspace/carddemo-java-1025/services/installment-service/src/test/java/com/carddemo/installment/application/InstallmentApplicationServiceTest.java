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
import com.carddemo.installment.domain.model.InstallmentApplicationIntent;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRate;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.AccountLockRepository;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentApplicationIntentRepository;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 提交分期用例（REQ-INS-04 / BR-INS-04/09/10/11/14/15、US-001/002/003/007，A-002/A-006/A-008）。
 * 外部依赖全部 Mock；幂等键窗口/内容、意图续跑与冲正、借贷平衡在此锁定。
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
    private InstallmentApplicationIntentRepository intentRepository;
    private AccountPort accountPort;
    private TransactionPort transactionPort;
    private BillingPort billingPort;
    private LedgerPort ledgerPort;
    private AuditPort auditPort;
    private NotificationPort notificationPort;
    private AccessGuard accessGuard;
    private PreviewTokenService previewTokens;
    private InstallmentPolicy policy;
    private InstallmentApplicationService service;

    private final Map<String, InstallmentApplicationIntent> intentsById = new HashMap<>();
    private final Map<String, InstallmentApplicationIntent> intentsByKey = new HashMap<>();

    @BeforeEach
    void setUp() {
        policyRepository = mock(InstallmentPolicyRepository.class);
        rateRepository = mock(InstallmentRateRepository.class);
        planRepository = mock(InstallmentPlanRepository.class);
        scheduleRepository = mock(InstallmentScheduleRepository.class);
        allocationRepository = mock(PrincipalAllocationRepository.class);
        flagRepository = mock(EligibilityFlagRepository.class);
        lockRepository = mock(AccountLockRepository.class);
        intentRepository = mock(InstallmentApplicationIntentRepository.class);
        accountPort = mock(AccountPort.class);
        transactionPort = mock(TransactionPort.class);
        billingPort = mock(BillingPort.class);
        ledgerPort = mock(LedgerPort.class);
        auditPort = mock(AuditPort.class);
        notificationPort = mock(NotificationPort.class);
        accessGuard = mock(AccessGuard.class);
        previewTokens = new PreviewTokenService("preview-secret", 30);

        policy = mock(InstallmentPolicy.class);
        when(policy.getMinTransactionAmount()).thenReturn(new BigDecimal("100.00"));
        when(policy.getMinBillAmount()).thenReturn(new BigDecimal("500.00"));
        when(policy.getMaxActivePlansPerAccount()).thenReturn(20);
        when(policy.getPenaltyRate()).thenReturn(new BigDecimal("0.0100"));
        when(policy.getIdempotencyWindowMinutes()).thenReturn(30);
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

        when(intentRepository.saveAndFlush(any(InstallmentApplicationIntent.class))).thenAnswer(invocation -> {
            InstallmentApplicationIntent intent = invocation.getArgument(0);
            intentsById.put(intent.getIntentId(), intent);
            intentsByKey.put(intent.getIdempotencyKey(), intent);
            return intent;
        });
        when(intentRepository.findById(anyString())).thenAnswer(invocation ->
                Optional.ofNullable(intentsById.get(invocation.getArgument(0))));
        when(intentRepository.findByIdempotencyKey(anyString())).thenAnswer(invocation ->
                Optional.ofNullable(intentsByKey.get(invocation.getArgument(0))));

        PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
        when(transactionManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        service = new InstallmentApplicationService(policyRepository, rateRepository, planRepository,
                scheduleRepository, allocationRepository, flagRepository, lockRepository, intentRepository,
                accountPort, transactionPort, billingPort, ledgerPort, auditPort, notificationPort,
                new EligibilityPolicy(), new FeeScheduleCalculator(), previewTokens, accessGuard, clock,
                transactionManager);
    }

    private String token(BigDecimal principal) {
        return previewTokens.issue(new PreviewTokenService.PreviewPayload(ACCOUNT, SourceType.TRANSACTION,
                TXN, principal, 6, new BigDecimal("0.0055"), NOW));
    }

    private InstallmentApplicationService.CreateCommand command(String idempotencyKey, BigDecimal principal) {
        return new InstallmentApplicationService.CreateCommand(ACCOUNT, SourceType.TRANSACTION, TXN, principal,
                6, token(principal), true, idempotencyKey);
    }

    private InstallmentApplicationIntent completedIntent(String key, BigDecimal principal, LocalDateTime createdAt) {
        InstallmentApplicationIntent intent = new InstallmentApplicationIntent("INTENT" + key, key, ACCOUNT,
                SourceType.TRANSACTION, TXN, principal, 6, new BigDecimal("0.0055"), new BigDecimal("19.25"),
                "IP-INTENT" + key, createdAt);
        intent.markCompleted(createdAt);
        intentsById.put(intent.getIntentId(), intent);
        intentsByKey.put(key, intent);
        return intent;
    }

    @Test
    void createsActivePlanWithSixSchedulesAndBalancedLedger() {
        InstallmentApplicationService.CreateResult result =
                service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isFalse();
        ArgumentCaptor<InstallmentPlan> planCaptor = ArgumentCaptor.forClass(InstallmentPlan.class);
        verify(planRepository).save(planCaptor.capture());
        InstallmentPlan plan = planCaptor.getValue();
        assertThat(plan.getTotalFee()).isEqualByComparingTo("19.25");
        assertThat(plan.getRemainingPrincipal()).isEqualByComparingTo("1000.00");
        assertThat(plan.getStatus().name()).isEqualTo("ACTIVE");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<InstallmentSchedule>> scheduleCaptor = ArgumentCaptor.forClass(List.class);
        verify(scheduleRepository).saveAll(scheduleCaptor.capture());
        assertThat(scheduleCaptor.getValue()).hasSize(6);
        assertThat(scheduleCaptor.getValue().get(0).getDueDate()).isEqualTo(LocalDate.of(2026, 11, 9));
        assertThat(scheduleCaptor.getValue().get(5).getPrincipalDue()).isEqualByComparingTo("166.70");

        verify(ledgerPort).postGroup(eq(plan.getPlanId()), eq("INSTALLMENT_CREATE"), eq(plan.getPlanId()), any());
        assertThat(intentsByKey.get("key-1").getStatus()).isEqualTo(InstallmentApplicationIntent.COMPLETED);
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_CREATED"), anyString(), anyString(), anyString());
        verify(notificationPort).enqueue(anyString(), eq(ACCOUNT), eq("INSTALLMENT_CREATED"), anyString());
    }

    @Test
    @SuppressWarnings("unchecked")
    void createLedgerGroupIsBalanced() {
        service.create(CUSTOMER, command("key-balance", new BigDecimal("1000.00")));

        ArgumentCaptor<List<LedgerPort.JournalLine>> captor = ArgumentCaptor.forClass(List.class);
        verify(ledgerPort).postGroup(eq("IP" + intentsByKey.get("key-balance").getIntentId()),
                eq("INSTALLMENT_CREATE"), anyString(), captor.capture());
        assertThat(captor.getValue()).hasSize(3);
        BigDecimal debit = captor.getValue().stream().filter(line -> "DEBIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal credit = captor.getValue().stream().filter(line -> "CREDIT".equals(line.direction()))
                .map(LedgerPort.JournalLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(debit).isEqualByComparingTo(credit);
        assertThat(debit).isEqualByComparingTo("1019.25");
    }

    @Test
    void sameIdempotencyKeyReplaysCompletedPlanWithoutSecondPosting() {
        completedIntent("key-1", new BigDecimal("1000.00"), NOW.minusMinutes(5));
        InstallmentPlan plan = mock(InstallmentPlan.class);
        when(planRepository.findById("IP-INTENTkey-1")).thenReturn(Optional.of(plan));

        InstallmentApplicationService.CreateResult result =
                service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isTrue();
        assertThat(result.plan()).isSameAs(plan);
        verify(planRepository, never()).save(any());
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
    }

    @Test
    void sameKeyWithDifferentContentIsRejected() {
        completedIntent("key-1", new BigDecimal("1000.00"), NOW.minusMinutes(5));

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-1", new BigDecimal("900.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void sameKeyOutsideIdempotencyWindowIsRejected() {
        completedIntent("key-1", new BigDecimal("1000.00"), NOW.minusMinutes(31));

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_EXPIRED");
    }

    @Test
    void compensatedIntentCannotBeReused() {
        InstallmentApplicationIntent intent = completedIntent("key-1", new BigDecimal("1000.00"), NOW.minusMinutes(5));
        intent.markReversed("principal unavailable", NOW.minusMinutes(4));

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-1", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void staleLedgerPostedIntentResumesWithoutSecondJournalGroup() {
        InstallmentApplicationIntent intent = new InstallmentApplicationIntent("INTENTRESUME", "key-r", ACCOUNT,
                SourceType.TRANSACTION, TXN, new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                new BigDecimal("19.25"), "IPINTENTRESUME", NOW.minusMinutes(2));
        intent.markLedgerPosted(NOW.minusMinutes(2));
        intentsById.put(intent.getIntentId(), intent);
        intentsByKey.put("key-r", intent);

        InstallmentApplicationService.CreateResult result =
                service.create(CUSTOMER, command("key-r", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isTrue();
        verify(ledgerPort, org.mockito.Mockito.times(1))
                .postGroup(eq("IPINTENTRESUME"), eq("INSTALLMENT_CREATE"), anyString(), any());
        verify(planRepository).save(any(InstallmentPlan.class));
        assertThat(intent.getStatus()).isEqualTo(InstallmentApplicationIntent.COMPLETED);
    }

    @Test
    void reconcilePendingCompletesStaleIntent() {
        InstallmentApplicationIntent intent = new InstallmentApplicationIntent("INTENTRECON", "key-recon", ACCOUNT,
                SourceType.TRANSACTION, TXN, new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                new BigDecimal("19.25"), "IPINTENTRECON", NOW.minusMinutes(10));
        intent.markLedgerPosted(NOW.minusMinutes(10));
        intentsById.put(intent.getIntentId(), intent);
        intentsByKey.put("key-recon", intent);
        when(intentRepository.findByStatusInAndUpdatedAtBefore(any(), any())).thenReturn(List.of(intent));

        int completed = service.reconcilePending();

        assertThat(completed).isEqualTo(1);
        verify(planRepository).save(any(InstallmentPlan.class));
        assertThat(intent.getStatus()).isEqualTo(InstallmentApplicationIntent.COMPLETED);
    }

    @Test
    void businessFailureAfterPostingPostsReversalGroup() {
        when(allocationRepository.existsByTransactionId(TXN)).thenReturn(true);

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-5", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("ALREADY_INSTALLED");

        ArgumentCaptor<String> groupCaptor = ArgumentCaptor.forClass(String.class);
        verify(ledgerPort, org.mockito.Mockito.times(2))
                .postGroup(groupCaptor.capture(), anyString(), anyString(), any());
        assertThat(groupCaptor.getAllValues().get(1)).endsWith("-REV");
        assertThat(intentsByKey.get("key-5").getStatus()).isEqualTo(InstallmentApplicationIntent.REVERSED);
        verify(planRepository, never()).save(any());
    }

    @Test
    void ledgerFailureLeavesIntentResumable() {
        doThrow(new RemoteServiceException("ledger-service", "ledger down"))
                .when(ledgerPort).postGroup(anyString(), anyString(), anyString(), any());

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-7", new BigDecimal("1000.00"))))
                .isInstanceOf(RemoteServiceException.class);
        verify(planRepository, never()).save(any());
        assertThat(intentsByKey.get("key-7").getStatus()).isNotEqualTo(InstallmentApplicationIntent.COMPLETED);
        assertThat(intentsByKey.get("key-7").isResumable()).isTrue();
        assertThat(intentsByKey.get("key-7").getLastError()).contains("ledger down");
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
        assertThat(intentsByKey).isEmpty();
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
        when(planRepository.countByAccountIdAndStatus(ACCOUNT, PlanStatus.ACTIVE)).thenReturn(20L);

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-4", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_LIMIT_EXCEEDED");
        verify(planRepository, never()).save(any());
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
    void billPlanAllocatesAcrossUninstalledTransactions() {
        InstallmentRate rate3 = mock(InstallmentRate.class);
        when(rate3.getMonthlyFeeRate()).thenReturn(new BigDecimal("0.0060"));
        when(rateRepository.findById(3)).thenReturn(Optional.of(rate3));

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

        ArgumentCaptor<PrincipalAllocation> allocationCaptor =
                ArgumentCaptor.forClass(PrincipalAllocation.class);
        verify(allocationRepository).save(allocationCaptor.capture());
        assertThat(allocationCaptor.getValue().getTransactionId()).isEqualTo("0000000000000005");
        assertThat(allocationCaptor.getValue().getPrincipalAmount()).isEqualByComparingTo("1000.00");
        verify(planRepository).save(any(InstallmentPlan.class));
    }

    @Test
    void disputedTransactionIsRejectedEvenWhenPreviewedEarlier() {
        com.carddemo.installment.domain.model.EligibilityFlag flag =
                mock(com.carddemo.installment.domain.model.EligibilityFlag.class);
        when(flag.isDisputed()).thenReturn(true);
        when(flag.isDelinquent()).thenReturn(false);
        when(flagRepository.findById(TXN)).thenReturn(Optional.of(flag));

        assertThatThrownBy(() -> service.create(CUSTOMER, command("key-9", new BigDecimal("1000.00"))))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_NOT_ELIGIBLE");
        verify(planRepository, never()).save(any());
    }

    @Test
    void schedulesNeverDuplicateAllocationsForSameTransaction() {
        List<PrincipalAllocation> saved = new ArrayList<>();
        when(allocationRepository.save(any(PrincipalAllocation.class))).thenAnswer(invocation -> {
            saved.add(invocation.getArgument(0));
            return invocation.getArgument(0);
        });

        service.create(CUSTOMER, command("key-10", new BigDecimal("1000.00")));

        assertThat(saved).hasSize(1);
        assertThat(saved.get(0).getTransactionId()).isEqualTo(TXN);
    }

    @Test
    void concurrentSameKeyRequestIsMarkedAsReplay() {
        // 预检查未命中，账户锁内重查命中同一意图 → 并发请求必须返回 200 语义（replayed=true）
        InstallmentApplicationIntent winner = new InstallmentApplicationIntent("INTENTCONC", "key-conc", ACCOUNT,
                SourceType.TRANSACTION, TXN, new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                new BigDecimal("19.25"), "IPINTENTCONC", NOW.minusSeconds(1));
        winner.markCompleted(NOW.minusSeconds(1));
        when(intentRepository.findByIdempotencyKey("key-conc"))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(winner));
        InstallmentPlan plan = mock(InstallmentPlan.class);
        when(planRepository.findById("IPINTENTCONC")).thenReturn(Optional.of(plan));

        InstallmentApplicationService.CreateResult result =
                service.create(CUSTOMER, command("key-conc", new BigDecimal("1000.00")));

        assertThat(result.replayed()).isTrue();
        assertThat(result.plan()).isSameAs(plan);
        verify(ledgerPort, never()).postGroup(anyString(), anyString(), anyString(), any());
        verify(planRepository, never()).save(any());
    }
}
