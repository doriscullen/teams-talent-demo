package com.carddemo.installment.application;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentRepaymentRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** REQ-INS-05：分页/状态参数服务端校验、越权 404、还款计划缺失告警。 */
class InstallmentQueryServiceTest {

    private static final String ACCOUNT = "00000000006";
    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private InstallmentPlanRepository planRepository;
    private InstallmentScheduleRepository scheduleRepository;
    private InstallmentRepaymentRepository repaymentRepository;
    private AuditPort auditPort;
    private InstallmentQueryService service;

    @BeforeEach
    void setUp() {
        planRepository = mock(InstallmentPlanRepository.class);
        scheduleRepository = mock(InstallmentScheduleRepository.class);
        repaymentRepository = mock(InstallmentRepaymentRepository.class);
        auditPort = mock(AuditPort.class);
        service = new InstallmentQueryService(planRepository, scheduleRepository, repaymentRepository,
                mock(AccessGuard.class), auditPort, mock(ClockProvider.class));
    }

    private InstallmentPlan plan() {
        return new InstallmentPlan("IP0001", ACCOUNT, null, SourceType.TRANSACTION, "0000000000000200",
                new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"), new BigDecimal("19.25"),
                "key-1", LocalDateTime.of(2026, 10, 27, 10, 0));
    }

    @Test
    void rejectsInvalidPaging() {
        assertThatThrownBy(() -> service.list(CUSTOMER, ACCOUNT, null, 0, 20))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode()).isEqualTo("INVALID_PARAMETER");
        assertThatThrownBy(() -> service.list(CUSTOMER, ACCOUNT, null, 1, 101))
                .isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> service.list(CUSTOMER, ACCOUNT, null, 1, 0))
                .isInstanceOf(BusinessRuleException.class);
    }

    @Test
    void rejectsUnknownStatusFilter() {
        assertThatThrownBy(() -> service.list(CUSTOMER, ACCOUNT, "PAID", 1, 20))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode()).isEqualTo("INVALID_PARAMETER");
    }

    @Test
    void listsOnlyRequestedStatusWhenFilterProvided() {
        Page<InstallmentPlan> page = new PageImpl<>(List.of(plan()));
        when(planRepository.findByAccountIdAndStatus(eq(ACCOUNT), eq(PlanStatus.ACTIVE), any(PageRequest.class)))
                .thenReturn(page);

        InstallmentQueryService.PlanPage result = service.list(CUSTOMER, ACCOUNT, "ACTIVE", 1, 20);

        assertThat(result.items()).hasSize(1);
        assertThat(result.total()).isEqualTo(1);
        assertThat(result.items().get(0).totalFee()).isEqualByComparingTo("19.25");
    }

    @Test
    void detailOfMissingPlanIsNotFound() {
        when(planRepository.findById("nope")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.detail(CUSTOMER, "nope")).isInstanceOf(NotFoundException.class);
    }

    @Test
    void detailWithoutSchedulesFlagsInconsistency() {
        when(planRepository.findById("IP0001")).thenReturn(Optional.of(plan()));
        when(scheduleRepository.findByPlanIdOrderByInstallmentNo("IP0001")).thenReturn(List.of());

        InstallmentQueryService.PlanView view = service.detail(CUSTOMER, "IP0001");

        assertThat(view.warning()).isEqualTo("SCHEDULE_INCONSISTENT");
        verify(scheduleRepository).findByPlanIdOrderByInstallmentNo("IP0001");
    }

    @Test
    void backOfficeListAuditsQueryWithActorAndFilters() {
        when(planRepository.findByAccountIdAndStatus(eq(ACCOUNT), eq(PlanStatus.ACTIVE), any(PageRequest.class)))
                .thenReturn(new PageImpl<>(List.of(plan())));
        when(scheduleRepository.findByPlanIdOrderByInstallmentNo("IP0001")).thenReturn(List.of());

        InstallmentQueryService.PlanPage page = service.backOfficeList(CUSTOMER, ACCOUNT, "ACTIVE", 2, 10);

        assertThat(page.items()).hasSize(1);
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_BACKOFFICE_QUERYED"), eq("INSTALLMENT_PLAN"),
                eq(ACCOUNT), org.mockito.ArgumentMatchers.contains("page=2"));
    }

    @Test
    void backOfficeDetailAuditsView() {
        when(planRepository.findById("IP0001")).thenReturn(Optional.of(plan()));
        when(scheduleRepository.findByPlanIdOrderByInstallmentNo("IP0001")).thenReturn(List.of());
        when(repaymentRepository.findByPlanIdOrderByCreatedAtAsc("IP0001")).thenReturn(List.of());

        InstallmentQueryService.PlanView view = service.backOfficeDetail(CUSTOMER, "IP0001");

        assertThat(view.planId()).isEqualTo("IP0001");
        assertThat(view.repayments()).isEmpty();
        verify(auditPort).record(eq("USER0001"), eq("INSTALLMENT_BACKOFFICE_VIEWED"), eq("INSTALLMENT_PLAN"),
                eq("IP0001"), any());
    }
}
