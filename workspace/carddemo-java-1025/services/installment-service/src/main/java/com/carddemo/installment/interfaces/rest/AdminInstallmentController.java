package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.application.AdminExportService;
import com.carddemo.installment.application.InstallmentQueryService;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.UnauthorizedException;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

/**
 * 后台分期查询与导出（REQ-INS-07 / US-008）：仅具备后台权限点的身份可访问；
 * 风控/合规只读身份也可查询与导出，但不可调用写接口（AC-21）。
 */
@Tag(name = "分期后台", description = "后台查询、CSV 导出与逾期/争议信号维护")
@RestController
@RequestMapping("/api/v1/admin/installments")
public class AdminInstallmentController {

    /** 逾期/争议信号维护请求（AC-17 测试数据来源；仅客服可写）。 */
    public record EligibilityFlagRequest(@NotBlank @Size(max = 16) String transactionId,
                                         boolean disputed, boolean delinquent) {
    }

    private final InstallmentQueryService queryService;
    private final AdminExportService exportService;
    private final EligibilityFlagRepository flagRepository;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;

    public AdminInstallmentController(InstallmentQueryService queryService,
                                      AdminExportService exportService,
                                      EligibilityFlagRepository flagRepository,
                                      AccessGuard accessGuard,
                                      ClockProvider clock) {
        this.queryService = queryService;
        this.exportService = exportService;
        this.flagRepository = flagRepository;
        this.accessGuard = accessGuard;
        this.clock = clock;
    }

    @Operation(summary = "后台分期查询")
    @GetMapping
    public InstallmentQueryService.PlanPage list(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @RequestParam(required = false) String accountId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        requirePrincipal(principal);
        return queryService.backOfficeList(principal, accountId, status, page, size);
    }

    @Operation(summary = "创建 30 天 CSV 导出", description = "文件 24 小时内可下载，导出动作写审计。")
    @PostMapping("/exports")
    public AdminExportService.ExportTicket createExport(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @RequestParam(defaultValue = "30") int days) {
        requirePrincipal(principal);
        return exportService.createExport(principal, days);
    }

    @Operation(summary = "下载导出文件", description = "超过 24 小时返回 410 EXPORT_EXPIRED。")
    @GetMapping("/exports/{exportId}")
    public ResponseEntity<byte[]> download(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @PathVariable String exportId) {
        requirePrincipal(principal);
        AdminExportService.DownloadPayload payload = exportService.download(principal, exportId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + payload.fileName() + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(payload.content().getBytes(StandardCharsets.UTF_8));
    }

    @Operation(summary = "维护交易逾期/争议信号", description = "仅客服可写；风控/合规只读身份返回 403。")
    @PostMapping("/eligibility-flags")
    public EligibilityFlag updateFlag(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @Valid @RequestBody EligibilityFlagRequest request) {
        requirePrincipal(principal);
        if (!accessGuard.canAssistWrite(principal)) {
            throw new com.carddemo.installment.domain.exception.ForbiddenException(
                    "Only staff with assist permission can maintain eligibility flags.");
        }
        EligibilityFlag flag = flagRepository.findById(request.transactionId()).orElse(null);
        if (flag == null) {
            flag = new EligibilityFlag(request.transactionId(), request.disputed(), request.delinquent(), clock.now());
        } else {
            flag.update(request.disputed(), request.delinquent(), clock.now());
        }
        return flagRepository.save(flag);
    }

    private static void requirePrincipal(InstallmentPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("A valid IAM token is required.");
        }
    }
}
