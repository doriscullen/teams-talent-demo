package com.carddemo.installment.application;

import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.InstallmentPolicy;
import com.carddemo.installment.domain.model.InstallmentRate;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.InstallmentPolicyRepository;
import com.carddemo.installment.domain.repository.InstallmentRateRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import com.carddemo.installment.domain.service.EligibilityPolicy;
import com.carddemo.installment.domain.service.FeeScheduleCalculator;
import com.carddemo.installment.infrastructure.security.PreviewTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** REQ-INS-03 / BR-INS-01/02/06/15：试算边界、风险信号与可分期本金。 */
class PreviewServiceTest {

    private static final String ACCOUNT = "00000000006";
    private static final String TXN = "0000000000000200";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);

    private PrincipalAllocationRepository allocationRepository;
    private EligibilityFlagRepository flagRepository;
    private TransactionPort transactionPort;
    private BillingPort billingPort;
    private InstallmentRateRepository rateRepository;
    private PreviewService service;

    @BeforeEach
    void setUp() {
        InstallmentPolicyRepository policyRepository = mock(InstallmentPolicyRepository.class);
        rateRepository = mock(InstallmentRateRepository.class);
        allocationRepository = mock(PrincipalAllocationRepository.class);
        flagRepository = mock(EligibilityFlagRepository.class);
        transactionPort = mock(TransactionPort.class);
        billingPort = mock(BillingPort.class);

        InstallmentPolicy policy = mock(InstallmentPolicy.class);
        when(policy.getMinTransactionAmount()).thenReturn(new BigDecimal("100.00"));
        when(policy.getMinBillAmount()).thenReturn(new BigDecimal("500.00"));
        when(policy.getMaxActivePlansPerAccount()).thenReturn(20);
        when(policyRepository.findById((short) 1)).thenReturn(Optional.of(policy));

        InstallmentRate rate = mock(InstallmentRate.class);
        when(rate.getMonthlyFeeRate()).thenReturn(new BigDecimal("0.0055"));
        when(rateRepository.findById(6)).thenReturn(Optional.of(rate));

        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        when(clock.today()).thenReturn(NOW.toLocalDate());

        when(transactionPort.findTransaction(TXN)).thenReturn(Optional.of(new TransactionPort.TransactionView(
                TXN, ACCOUNT, "3344556677889900", "01", "0001", "Purchase", new BigDecimal("1000.00"),
                NOW.minusDays(1), "POSTED")));

        service = new PreviewService(policyRepository, rateRepository, flagRepository, allocationRepository,
                transactionPort, billingPort, new EligibilityPolicy(), new FeeScheduleCalculator(),
                new PreviewTokenService("preview-secret", 30), clock);
    }

    private PreviewService.PreviewCommand command(BigDecimal principal, int term) {
        return new PreviewService.PreviewCommand(ACCOUNT, SourceType.TRANSACTION, TXN, principal, term);
    }

    @Test
    void transactionPreviewReturnsProfileFeeAndToken() {
        PreviewService.PreviewResult result = service.preview(command(new BigDecimal("1000.00"), 6));

        assertThat(result.totalFee()).isEqualByComparingTo("19.25");
        assertThat(result.firstPeriodTotal()).isEqualByComparingTo("172.16");
        assertThat(result.availablePrincipal()).isEqualByComparingTo("1000.00");
        assertThat(result.periods()).hasSize(6);
        assertThat(result.previewToken()).isNotBlank();
    }

    @Test
    void belowMinimumPrincipalIsRejected() {
        assertThatThrownBy(() -> service.preview(command(new BigDecimal("99.99"), 6)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_NOT_ELIGIBLE");
    }

    @Test
    void unsupportedTermIsRejected() {
        assertThatThrownBy(() -> service.preview(command(new BigDecimal("1000.00"), 9)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INVALID_TERM");
    }

    @Test
    void principalAboveTransactionAmountIsRejected() {
        assertThatThrownBy(() -> service.preview(command(new BigDecimal("1000.01"), 6)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PRINCIPAL_EXCEEDS_LIMIT");
    }

    @Test
    void disputedTransactionIsNotEligible() {
        when(flagRepository.findById(TXN)).thenReturn(Optional.of(
                new EligibilityFlag(TXN, true, false, NOW)));

        assertThatThrownBy(() -> service.preview(command(new BigDecimal("1000.00"), 6)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("INSTALLMENT_NOT_ELIGIBLE");
    }

    @Test
    void alreadyInstallmentedPrincipalIsRejected() {
        when(allocationRepository.existsByTransactionId(TXN)).thenReturn(true);

        assertThatThrownBy(() -> service.preview(command(new BigDecimal("1000.00"), 6)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("ALREADY_INSTALLED");
    }

    @Test
    void billPreviewUsesStatementAvailablePrincipal() {
        InstallmentRate rate3 = mock(InstallmentRate.class);
        when(rate3.getMonthlyFeeRate()).thenReturn(new BigDecimal("0.0060"));
        when(rateRepository.findById(3)).thenReturn(Optional.of(rate3));
        when(billingPort.currentStatement(ACCOUNT)).thenReturn(new BillingPort.BillingStatement(
                "BILL20261000000000006", ACCOUNT, LocalDate.of(2026, 9, 9), LocalDate.of(2026, 10, 27),
                new BigDecimal("1500.00"), new BigDecimal("700.00"),
                List.of(new BillingPort.BillingLine(TXN, new BigDecimal("700.00"),
                        LocalDate.of(2026, 10, 1), "Purchase"))));

        PreviewService.PreviewResult result = service.preview(new PreviewService.PreviewCommand(
                ACCOUNT, SourceType.BILL, "BILL20261000000000006", new BigDecimal("500.00"), 3));

        assertThat(result.availablePrincipal()).isEqualByComparingTo("700.00");
        assertThat(result.billId()).isEqualTo("BILL20261000000000006");

        assertThatThrownBy(() -> service.preview(new PreviewService.PreviewCommand(
                ACCOUNT, SourceType.BILL, "BILL20261000000000006", new BigDecimal("700.01"), 3)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PRINCIPAL_EXCEEDS_LIMIT");
    }
}
