package com.carddemo.installment.infrastructure.billing;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** ADR-011 最小账单能力：账期锚点、可分期本金扣除已占用本金（BR-INS-09）。 */
class BillingStatementServiceTest {

    private static final String ACCOUNT = "00000000006";
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 27);

    private TransactionPort transactionPort;
    private PrincipalAllocationRepository allocationRepository;
    private EligibilityFlagRepository flagRepository;
    private BillingStatementService service;

    @BeforeEach
    void setUp() {
        AccountPort accountPort = mock(AccountPort.class);
        when(accountPort.getAccount(ACCOUNT)).thenReturn(new AccountPort.AccountSnapshot(
                ACCOUNT, "Y", new BigDecimal("2450.75"), new BigDecimal("8000.00"),
                new BigDecimal("4000.00"), LocalDate.of(2018, 3, 9)));
        transactionPort = mock(TransactionPort.class);
        allocationRepository = mock(PrincipalAllocationRepository.class);
        flagRepository = mock(EligibilityFlagRepository.class);
        when(flagRepository.findById(anyString())).thenReturn(java.util.Optional.empty());
        ClockProvider clock = mock(ClockProvider.class);
        when(clock.today()).thenReturn(TODAY);
        service = new BillingStatementService(accountPort, transactionPort, allocationRepository,
                flagRepository, clock);
    }

    @Test
    void cycleStartsOnPreviousMonthAnchorAndClampsToMonthEnd() {
        assertThat(BillingStatementService.cycleStart(LocalDate.of(2018, 3, 31), LocalDate.of(2026, 4, 30)))
                .isEqualTo(LocalDate.of(2026, 3, 31));
        assertThat(BillingStatementService.cycleStart(LocalDate.of(2018, 3, 31), LocalDate.of(2026, 3, 15)))
                .isEqualTo(LocalDate.of(2026, 2, 28));
        assertThat(BillingStatementService.cycleStart(LocalDate.of(2018, 3, 9), TODAY))
                .isEqualTo(LocalDate.of(2026, 9, 9));
    }

    @Test
    void statementExcludesNonPurchasesAndOutOfCycleTransactions() {
        when(transactionPort.listAccountTransactions(ACCOUNT, 0, 100)).thenReturn(List.of(
                new TransactionPort.TransactionView("0000000000000005", ACCOUNT, "3344556677889900", "01",
                        "0001", "Purchase in cycle", new BigDecimal("1500.00"),
                        LocalDateTime.of(2026, 10, 1, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000006", ACCOUNT, "3344556677889900", "02",
                        "0002", "Payment", new BigDecimal("300.00"),
                        LocalDateTime.of(2026, 10, 5, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000007", ACCOUNT, "3344556677889900", "01",
                        "0001", "Before cycle", new BigDecimal("300.00"),
                        LocalDateTime.of(2026, 9, 1, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000008", ACCOUNT, "3344556677889900", "01",
                        "0001", "Pending purchase", new BigDecimal("50.00"),
                        LocalDateTime.of(2026, 10, 2, 9, 0), "PENDING")));
        when(allocationRepository.findByTransactionIdIn(any())).thenReturn(List.of());

        BillingPort.BillingStatement statement = service.currentStatement(ACCOUNT);

        assertThat(statement.cycleStart()).isEqualTo(LocalDate.of(2026, 9, 9));
        assertThat(statement.lines()).hasSize(1);
        assertThat(statement.billPrincipal()).isEqualByComparingTo("1500.00");
        assertThat(statement.availablePrincipal()).isEqualByComparingTo("1500.00");
        assertThat(statement.billId()).isEqualTo("BILL20261000000000006");
    }

    @Test
    void availablePrincipalExcludesAlreadyAllocatedTransactionPrincipal() {
        when(transactionPort.listAccountTransactions(ACCOUNT, 0, 100)).thenReturn(List.of(
                new TransactionPort.TransactionView("0000000000000005", ACCOUNT, "3344556677889900", "01",
                        "0001", "Purchase A", new BigDecimal("1500.00"),
                        LocalDateTime.of(2026, 10, 1, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000009", ACCOUNT, "3344556677889900", "01",
                        "0001", "Purchase B", new BigDecimal("200.00"),
                        LocalDateTime.of(2026, 9, 20, 9, 0), "POSTED")));
        when(allocationRepository.findByTransactionIdIn(any())).thenReturn(List.of(
                new PrincipalAllocation("IP0001", "0000000000000009", new BigDecimal("200.00"))));

        BillingPort.BillingStatement statement = service.currentStatement(ACCOUNT);

        assertThat(statement.billPrincipal()).isEqualByComparingTo("1700.00");
        assertThat(statement.availablePrincipal()).isEqualByComparingTo("1500.00");
        assertThat(statement.lines()).extracting(BillingPort.BillingLine::transactionId)
                .containsExactly("0000000000000009", "0000000000000005");
    }

    @Test
    void emptyAccountProducesZeroBill() {
        when(transactionPort.listAccountTransactions(anyString(), anyInt(), anyInt())).thenReturn(List.of());

        BillingPort.BillingStatement statement = service.currentStatement(ACCOUNT);

        assertThat(statement.billPrincipal()).isEqualByComparingTo("0.00");
        assertThat(statement.availablePrincipal()).isEqualByComparingTo("0.00");
        assertThat(statement.lines()).isEmpty();
    }

    @Test
    void disputedAndDelinquentTransactionsAreExcludedFromBillPrincipal() {
        when(transactionPort.listAccountTransactions(ACCOUNT, 0, 100)).thenReturn(List.of(
                new TransactionPort.TransactionView("0000000000000011", ACCOUNT, "3344556677889900", "01",
                        "0001", "Disputed purchase", new BigDecimal("900.00"),
                        LocalDateTime.of(2026, 10, 1, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000012", ACCOUNT, "3344556677889900", "01",
                        "0001", "Delinquent purchase", new BigDecimal("600.00"),
                        LocalDateTime.of(2026, 10, 2, 9, 0), "POSTED"),
                new TransactionPort.TransactionView("0000000000000013", ACCOUNT, "3344556677889900", "01",
                        "0001", "Clean purchase", new BigDecimal("800.00"),
                        LocalDateTime.of(2026, 10, 3, 9, 0), "POSTED")));
        when(allocationRepository.findByTransactionIdIn(any())).thenReturn(List.of());
        when(flagRepository.findById("0000000000000011")).thenReturn(java.util.Optional.of(
                new EligibilityFlag("0000000000000011", true, false, LocalDateTime.of(2026, 10, 4, 9, 0))));
        when(flagRepository.findById("0000000000000012")).thenReturn(java.util.Optional.of(
                new EligibilityFlag("0000000000000012", false, true, LocalDateTime.of(2026, 10, 4, 9, 0))));

        BillingPort.BillingStatement statement = service.currentStatement(ACCOUNT);

        assertThat(statement.lines()).extracting(BillingPort.BillingLine::transactionId)
                .containsExactly("0000000000000013");
        assertThat(statement.billPrincipal()).isEqualByComparingTo("800.00");
        assertThat(statement.availablePrincipal()).isEqualByComparingTo("800.00");
    }
}
