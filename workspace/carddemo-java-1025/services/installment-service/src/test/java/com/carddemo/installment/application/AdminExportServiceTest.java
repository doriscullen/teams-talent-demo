package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.ExportExpiredException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.ExportFile;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.domain.repository.ExportFileRepository;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** US-008：CSV 导出 24 小时有效、权限校验、过期 410、无卡号字段。 */
class AdminExportServiceTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 28, 9, 0);
    private static final InstallmentPrincipal STAFF = new InstallmentPrincipal("ADMIN002", "A");

    private InstallmentPlanRepository planRepository;
    private ExportFileRepository exportFileRepository;
    private AuditPort auditPort;
    private AdminExportService service;

    @BeforeEach
    void setUp() {
        planRepository = mock(InstallmentPlanRepository.class);
        exportFileRepository = mock(ExportFileRepository.class);
        auditPort = mock(AuditPort.class);
        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);
        service = new AdminExportService(planRepository, exportFileRepository, mock(AccessGuard.class),
                auditPort, clock);

        when(planRepository.findAll()).thenReturn(List.of(
                new InstallmentPlan("IP0001", "00000000006", null, SourceType.TRANSACTION,
                        "0000000000000200", new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                        new BigDecimal("19.25"), "key-1", NOW.minusDays(2)),
                new InstallmentPlan("IP0002", "00000000005", null, SourceType.BILL,
                        "BILL20261000000000005", new BigDecimal("500.00"), 3, new BigDecimal("0.0060"),
                        new BigDecimal("6.00"), "key-2", NOW.minusDays(40))));
    }

    @Test
    void exportContainsThirtyDayRowsWithoutCardNumbers() {
        AdminExportService.ExportTicket ticket = service.createExport(STAFF, 30);

        ArgumentCaptor<ExportFile> captor = ArgumentCaptor.forClass(ExportFile.class);
        verify(exportFileRepository).save(captor.capture());
        ExportFile file = captor.getValue();

        assertThat(ticket.rowCount()).isEqualTo(1);
        assertThat(file.getExpiresAt()).isEqualTo(NOW.plusHours(24));
        assertThat(file.getContent()).startsWith("planId,accountId,sourceType");
        assertThat(file.getContent()).contains("IP0001").doesNotContain("IP0002");
        assertThat(file.getContent()).doesNotContain("cardNumber");
        verify(auditPort).record(eq("ADMIN002"), eq("INSTALLMENT_EXPORTED"), anyString(), anyString(),
                eq("rows=1,days=30"));
    }

    @Test
    void exportDaysMustBeWithinSupportedRange() {
        assertThatThrownBy(() -> service.createExport(STAFF, 0)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> service.createExport(STAFF, 91)).isInstanceOf(BusinessRuleException.class);
    }

    @Test
    void expiredExportIsGone() {
        ExportFile expired = new ExportFile("EXP1", "ADMIN002", 1, "csv", NOW.minusHours(25), NOW.minusHours(1));
        when(exportFileRepository.findById("EXP1")).thenReturn(Optional.of(expired));

        assertThatThrownBy(() -> service.download(STAFF, "EXP1")).isInstanceOf(ExportExpiredException.class);
    }

    @Test
    void missingExportIsNotFound() {
        when(exportFileRepository.findById(anyString())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.download(STAFF, "EXP404")).isInstanceOf(NotFoundException.class);
    }

    @Test
    void downloadWithinWindowReturnsCsvAndWritesAudit() {
        ExportFile file = new ExportFile("EXP2", "ADMIN002", 2, "a,b\n", NOW.minusHours(1), NOW.plusHours(23));
        when(exportFileRepository.findById("EXP2")).thenReturn(Optional.of(file));

        AdminExportService.DownloadPayload payload = service.download(STAFF, "EXP2");

        assertThat(payload.fileName()).isEqualTo("installments-EXP2.csv");
        assertThat(payload.content()).isEqualTo("a,b\n");
        verify(auditPort).record(eq("ADMIN002"), eq("INSTALLMENT_EXPORT_DOWNLOADED"), anyString(), eq("EXP2"),
                eq("rows=2"));
        verify(exportFileRepository, org.mockito.Mockito.never()).save(any());
    }
}
