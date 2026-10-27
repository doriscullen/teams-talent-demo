package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.application.AdminExportService;
import com.carddemo.installment.application.InstallmentQueryService;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.UnauthorizedException;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import com.carddemo.installment.infrastructure.support.AuditRetryWorker;
import com.carddemo.installment.infrastructure.support.LocalNotificationSender;
import com.carddemo.installment.infrastructure.support.NotificationWorker;
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
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 后台分期查询与导出（REQ-INS-07 / US-008）：仅具备后台权限点的身份可访问；
 * 风控/合规只读身份也可查询与导出，但不可调用写接口（AC-21）。
 * 后台查询/详情/导出均写审计（C-07）；通知投递与审计重试可在此观察与手动触发（C-03）。
 */
@Tag(name = "分期后台", description = "后台查询、CSV 导出、逾期/争议信号、通知与审计观察")
@RestController
@RequestMapping("/api/v1/admin/installments")
public class AdminInstallmentController {

    /** 逾期/争议信号维护请求（AC-17 测试数据来源；仅客服可写）。 */
    public record EligibilityFlagRequest(@NotBlank @Size(max = 16) String transactionId,
                                         boolean disputed, boolean delinquent) {
    }

    public record NotificationView(Long notificationId, String channel, String recipient, String template,
                                   String payload, String status, int attempts, String lastError,
                                   LocalDateTime createdAt, LocalDateTime sentAt) {
    }

    private final InstallmentQueryService queryService;
    private final AdminExportService exportService;
    private final EligibilityFlagRepository flagRepository;
    private final NotificationOutboxRepository notificationRepository;
    private final NotificationWorker notificationWorker;
    private final LocalNotificationSender notificationSender;
    private final AuditRetryWorker auditRetryWorker;
    private final AccessGuard accessGuard;
    private final ClockProvider clock;

    public AdminInstallmentController(InstallmentQueryService queryService,
                                      AdminExportService exportService,
                                      EligibilityFlagRepository flagRepository,
                                      NotificationOutboxRepository notificationRepository,
                                      NotificationWorker notificationWorker,
                                      LocalNotificationSender notificationSender,
                                      AuditRetryWorker auditRetryWorker,
                                      AccessGuard accessGuard,
                                      ClockProvider clock) {
        this.queryService = queryService;
        this.exportService = exportService;
        this.flagRepository = flagRepository;
        this.notificationRepository = notificationRepository;
        this.notificationWorker = notificationWorker;
        this.notificationSender = notificationSender;
        this.auditRetryWorker = auditRetryWorker;
        this.accessGuard = accessGuard;
        this.clock = clock;
    }

    @Operation(summary = "后台分期查询", description = "真实分页/筛选，写入后台查询审计。")
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

    @Operation(summary = "后台分期详情", description = "只读详情（含还款计划与还款记录），写入后台查看审计。")
    @GetMapping("/{planId}")
    public InstallmentQueryService.PlanView detail(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @PathVariable String planId) {
        requirePrincipal(principal);
        return queryService.backOfficeDetail(principal, planId);
    }

    @Operation(summary = "创建 30 天 CSV 导出", description = "文件 24 小时内可下载，导出动作写审计。")
    @PostMapping("/exports")
    public AdminExportService.ExportTicket createExport(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @RequestParam(defaultValue = "30") int days) {
        requirePrincipal(principal);
        return exportService.createExport(principal, days);
    }

    @Operation(summary = "下载导出文件", description = "超过 24 小时返回 410 EXPORT_EXPIRED；下载动作写审计。")
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
        requireAssistWrite(principal);
        EligibilityFlag flag = flagRepository.findById(request.transactionId()).orElse(null);
        if (flag == null) {
            flag = new EligibilityFlag(request.transactionId(), request.disputed(), request.delinquent(), clock.now());
        } else {
            flag.update(request.disputed(), request.delinquent(), clock.now());
        }
        return flagRepository.save(flag);
    }

    @Operation(summary = "通知发件箱与投递状态", description = "PENDING/FAILED/SENDING/SENT 与失败原因可观察（C-03）。")
    @GetMapping("/notifications")
    public Map<String, Object> notifications(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal) {
        requirePrincipal(principal);
        accessGuard.requireBackOfficeRead(principal);
        List<NotificationView> items = notificationRepository.findAllByOrderByNotificationIdAsc().stream()
                .map(AdminInstallmentController::toView)
                .toList();
        return Map.of("items", items, "sinkAvailable", notificationSender.isAvailable(),
                "deliveredFiles", notificationSender.deliveredFileCount());
    }

    @Operation(summary = "立即执行一轮通知投递", description = "仅客服；用于恢复后补发的可观察验证。")
    @PostMapping("/notifications/dispatch")
    public Map<String, Object> dispatchNotifications(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal) {
        requirePrincipal(principal);
        requireAssistWrite(principal);
        int sent = notificationWorker.dispatchDue();
        return Map.of("delivered", sent, "sinkAvailable", notificationSender.isAvailable());
    }

    @Operation(summary = "显式重排已耗尽的通知",
            description = "仅客服；对未投递成功的通知重置自动重试计数并立即投递一次，已 SENT 的幂等无操作（R-C-03）。")
    @PostMapping("/notifications/{notificationId}/requeue")
    public Map<String, Object> requeueNotification(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @PathVariable Long notificationId) {
        requirePrincipal(principal);
        requireAssistWrite(principal);
        boolean delivered = notificationWorker.requeueAndDispatch(notificationId);
        NotificationOutbox row = notificationRepository.findById(notificationId).orElse(null);
        return Map.of("delivered", delivered,
                "status", row == null ? "MISSING" : row.getStatus());
    }

    @Operation(summary = "切换本地通知投递目标可用性", description = "仅客服；故障注入/恢复验证用。")
    @PostMapping("/notifications/sink")
    public Map<String, Object> toggleNotificationSink(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @RequestParam boolean available) {
        requirePrincipal(principal);
        requireAssistWrite(principal);
        notificationSender.setAvailable(available);
        return Map.of("sinkAvailable", notificationSender.isAvailable());
    }

    @Operation(summary = "重放审计补偿队列", description = "仅客服；把审计重试队列真实落库为审计事件（C-07）。")
    @PostMapping("/audit-retries/replay")
    public Map<String, Object> replayAuditRetries(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal) {
        requirePrincipal(principal);
        requireAssistWrite(principal);
        int replayed = auditRetryWorker.replayQueue();
        return Map.of("replayed", replayed, "pending", auditRetryWorker.pendingCount());
    }

    private static NotificationView toView(NotificationOutbox notification) {
        return new NotificationView(notification.getNotificationId(), notification.getChannel(),
                notification.getRecipient(), notification.getTemplate(), notification.getPayload(),
                notification.getStatus(), notification.getAttempts(), notification.getLastError(),
                notification.getCreatedAt(), notification.getSentAt());
    }

    private void requireAssistWrite(InstallmentPrincipal principal) {
        if (!accessGuard.canAssistWrite(principal)) {
            throw new com.carddemo.installment.domain.exception.ForbiddenException(
                    "Only staff with assist permission can perform this action.");
        }
    }

    private static void requirePrincipal(InstallmentPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("A valid IAM token is required.");
        }
    }
}
