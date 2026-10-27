package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.ForbiddenException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.repository.AccountLimitViewRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 原文 §8.1 / US-004：账户额度视图的分期占用只来自 ACTIVE 计划剩余本金，且受归属与角色约束。 */
class AccountLimitViewServiceTest {

    private static final String ACCOUNT = "00000000006";
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");
    private static final InstallmentPrincipal RISK_READONLY = new InstallmentPrincipal("ADMIN003", "A");
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 28, 9, 0);

    private AccountLimitViewRepository viewRepository;
    private AccountPort accountPort;
    private AccessGuard accessGuard;
    private AuditPort auditPort;
    private AccountLimitViewService service;

    @BeforeEach
    void setUp() {
        viewRepository = mock(AccountLimitViewRepository.class);
        accountPort = mock(AccountPort.class);
        accessGuard = mock(AccessGuard.class);
        auditPort = mock(AuditPort.class);
        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        service = new AccountLimitViewService(viewRepository, accountPort, accessGuard, auditPort, clock);
    }

    private void givenAccount() {
        when(accountPort.getAccount(ACCOUNT)).thenReturn(new AccountPort.AccountSnapshot(ACCOUNT, "Y",
                new BigDecimal("1000.00"), new BigDecimal("20000.00"), new BigDecimal("8000.00"),
                LocalDate.of(2018, 3, 9)));
    }

    @Test
    void installmentOccupiedComesFromActivePlansOnly() {
        givenAccount();
        when(viewRepository.findOccupancy(ACCOUNT))
                .thenReturn(new AccountLimitViewRepository.Occupancy(new BigDecimal("1000.00"), 1));

        AccountLimitViewService.LimitView view = service.accountLimitView(CUSTOMER, ACCOUNT);

        assertThat(view.accountId()).isEqualTo(ACCOUNT);
        assertThat(view.creditLimit()).isEqualByComparingTo("20000.00");
        assertThat(view.cashCreditLimit()).isEqualByComparingTo("8000.00");
        assertThat(view.currentBalance()).isEqualByComparingTo("1000.00");
        assertThat(view.installmentOccupied()).isEqualByComparingTo("1000.00");
        assertThat(view.activePlanCount()).isEqualTo(1);
        assertThat(view.asOf()).isEqualTo(NOW);
    }

    @Test
    void installmentOccupiedIsZeroWithoutActivePlan() {
        givenAccount();
        when(viewRepository.findOccupancy(ACCOUNT))
                .thenReturn(new AccountLimitViewRepository.Occupancy(new BigDecimal("0.00"), 0));

        assertThat(service.accountLimitView(CUSTOMER, ACCOUNT).installmentOccupied())
                .isEqualByComparingTo("0.00");
    }

    @Test
    void readingTheViewNeverChangesBalanceOrAuditsCustomerReads() {
        givenAccount();
        when(viewRepository.findOccupancy(ACCOUNT))
                .thenReturn(new AccountLimitViewRepository.Occupancy(new BigDecimal("1000.00"), 1));

        service.accountLimitView(CUSTOMER, ACCOUNT);

        verify(accountPort, never()).applyRepayment(anyString(), any(), anyString());
        verifyNoInteractions(auditPort);
    }

    @Test
    void otherCustomerAccountIsNotFound() {
        doThrow(new NotFoundException("INSTALLMENT_NOT_FOUND", "Account is not accessible for this customer."))
                .when(accessGuard).requireReadAccess(CUSTOMER, ACCOUNT);

        assertThatThrownBy(() -> service.accountLimitView(CUSTOMER, ACCOUNT))
                .isInstanceOf(NotFoundException.class);
        verifyNoInteractions(accountPort, viewRepository);
    }

    @Test
    void backOfficeReadIsAudited() {
        givenAccount();
        when(viewRepository.findOccupancy(ACCOUNT))
                .thenReturn(new AccountLimitViewRepository.Occupancy(new BigDecimal("1000.00"), 1));

        service.accountLimitView(RISK_READONLY, ACCOUNT);

        verify(auditPort).record(eq("ADMIN003"), eq("INSTALLMENT_LIMIT_VIEWED"), eq("ACCOUNT"), eq(ACCOUNT),
                contains("installmentOccupied=1000.00"));
    }

    @Test
    void backOfficeWithoutPermissionIsForbidden() {
        doThrow(new ForbiddenException("Back-office user has no read permission for installments."))
                .when(accessGuard).requireReadAccess(RISK_READONLY, ACCOUNT);

        assertThatThrownBy(() -> service.accountLimitView(RISK_READONLY, ACCOUNT))
                .isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(accountPort, viewRepository);
    }

    @Test
    void accountServiceOutagePropagatesDownstreamFailure() {
        when(accountPort.getAccount(ACCOUNT))
                .thenThrow(new RemoteServiceException("account-service", "Account service is unavailable"));

        assertThatThrownBy(() -> service.accountLimitView(CUSTOMER, ACCOUNT))
                .isInstanceOf(RemoteServiceException.class);
    }
}
