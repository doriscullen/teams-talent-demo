package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.ExportExpiredException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.ExportFile;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.repository.ExportFileRepository;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 后台分期查询与导出（REQ-INS-07 / US-008）：CSV 24 小时可下载，导出动作写审计，卡号不出现。
 */
@Service
public class AdminExportService {

    private static final int MAX_EXPORT_ROWS = 5000;

    public record ExportTicket(String exportId, int rowCount, LocalDateTime expiresAt) {
    }

    public record DownloadPayload(String fileName, String content) {
    }

    private final InstallmentPlanRepository planRepository;
    private final ExportFileRepository exportFileRepository;
    private final AccessGuard accessGuard;
    private final AuditPort auditPort;
    private final ClockProvider clock;

    public AdminExportService(InstallmentPlanRepository planRepository,
                              ExportFileRepository exportFileRepository,
                              AccessGuard accessGuard,
                              AuditPort auditPort,
                              ClockProvider clock) {
        this.planRepository = planRepository;
        this.exportFileRepository = exportFileRepository;
        this.accessGuard = accessGuard;
        this.auditPort = auditPort;
        this.clock = clock;
    }

    @Transactional
    public ExportTicket createExport(InstallmentPrincipal principal, int days) {
        accessGuard.requireBackOfficeRead(principal);
        if (days < 1 || days > 90) {
            throw new BusinessRuleException("INVALID_PARAMETER", "days must be between 1 and 90.");
        }
        LocalDateTime now = clock.now();
        LocalDateTime from = now.minusDays(days);
        List<InstallmentPlan> plans = planRepository.findAll().stream()
                .filter(plan -> plan.getCreatedAt() != null && !plan.getCreatedAt().isBefore(from))
                .limit(MAX_EXPORT_ROWS)
                .toList();

        StringBuilder csv = new StringBuilder("planId,accountId,sourceType,sourceId,principal,termMonths,"
                + "monthlyFeeRate,totalFee,remainingPrincipal,status,createdAt,settledAt\n");
        for (InstallmentPlan plan : plans) {
            csv.append(String.join(",",
                    plan.getPlanId(),
                    plan.getAccountId(),
                    plan.getSourceType().name(),
                    plan.getSourceId(),
                    plan.getPrincipal().toPlainString(),
                    Integer.toString(plan.getTermMonths()),
                    plan.getMonthlyFeeRate().toPlainString(),
                    plan.getTotalFee().toPlainString(),
                    plan.getRemainingPrincipal().toPlainString(),
                    plan.getStatus().name(),
                    plan.getCreatedAt().toString(),
                    plan.getSettledAt() == null ? "" : plan.getSettledAt().toString())).append('\n');
        }

        ExportFile file = new ExportFile("EXP" + UUID.randomUUID().toString().replace("-", "").substring(0, 20),
                principal.userId(), plans.size(), csv.toString(), now, now.plusHours(24));
        exportFileRepository.save(file);
        auditPort.record(principal.userId(), "INSTALLMENT_EXPORTED", "INSTALLMENT_EXPORT", file.getExportId(),
                "rows=" + plans.size() + ",days=" + days);
        return new ExportTicket(file.getExportId(), file.getRowCount(), file.getExpiresAt());
    }

    @Transactional
    public DownloadPayload download(InstallmentPrincipal principal, String exportId) {
        accessGuard.requireBackOfficeRead(principal);
        ExportFile file = exportFileRepository.findById(exportId)
                .orElseThrow(() -> new NotFoundException("EXPORT_NOT_FOUND", "Export file not found."));
        if (file.isExpired(clock.now())) {
            throw new ExportExpiredException("Export file has expired (24h window).");
        }
        auditPort.record(principal.userId(), "INSTALLMENT_EXPORT_DOWNLOADED", "INSTALLMENT_EXPORT",
                file.getExportId(), "rows=" + file.getRowCount());
        return new DownloadPayload("installments-" + exportId + ".csv", file.getContent());
    }
}
