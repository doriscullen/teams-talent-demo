package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.application.InstallmentApplicationService;
import com.carddemo.installment.application.InstallmentQueryService;
import com.carddemo.installment.application.PreviewService;
import com.carddemo.installment.application.SettlementService;
import com.carddemo.installment.domain.exception.UnauthorizedException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 分期主接口（原文 §7）：试算 / 创建 / 我的分期 / 详情 / 提前结清。
 * 全部接口先经 {@link com.carddemo.installment.infrastructure.security.TokenAuthenticationFilter} 校验 IAM HMAC token。
 */
@Tag(name = "分期", description = "账单/消费分期试算、创建、查询与提前结清")
@RestController
@RequestMapping("/api/v1/installments")
public class InstallmentController {

    /** 试算请求（BR-INS-01/02；sourceId 交易 16 位、账单号 32 位以内）。 */
    public record PreviewRequest(
            @NotBlank @Pattern(regexp = "\\d{11}", message = "accountId must be 11 digits") String accountId,
            @NotNull SourceType sourceType,
            @NotBlank @Size(max = 32) String sourceId,
            @NotNull @DecimalMin(value = "0.01") BigDecimal principal,
            @NotNull Integer termMonths) {
    }

    /** 创建请求（§4.2，含 previewToken 与协议勾选）。 */
    public record CreateRequest(
            @NotBlank @Size(max = 64) String idempotencyKey,
            @NotBlank @Pattern(regexp = "\\d{11}", message = "accountId must be 11 digits") String accountId,
            @NotNull SourceType sourceType,
            @NotBlank @Size(max = 32) String sourceId,
            @NotNull @DecimalMin(value = "0.01") BigDecimal principal,
            @NotNull Integer termMonths,
            @NotBlank @Size(max = 512) String previewToken,
            boolean agreementAccepted) {
    }

    /** 结清请求（BR-INS-14：settlementIdempotencyKey 决定同键重放 200 / 新键 409）。 */
    public record SettlementRequest(
            @NotBlank @Size(max = 64) String settlementIdempotencyKey,
            @DecimalMin(value = "0.00") BigDecimal feeRebate) {
    }

    public record CreateResponse(String planId, String status, BigDecimal principal, int termMonths,
                                 BigDecimal totalFee, LocalDateTime createdAt) {
    }

    public record SettlementResponse(String planId, String status, BigDecimal remainingPrincipal,
                                     BigDecimal penaltyFee, BigDecimal feeRebate, BigDecimal settlementTotal,
                                     boolean replayed) {
    }

    private final PreviewService previewService;
    private final InstallmentApplicationService applicationService;
    private final InstallmentQueryService queryService;
    private final SettlementService settlementService;

    public InstallmentController(PreviewService previewService,
                                 InstallmentApplicationService applicationService,
                                 InstallmentQueryService queryService,
                                 SettlementService settlementService) {
        this.previewService = previewService;
        this.applicationService = applicationService;
        this.queryService = queryService;
        this.settlementService = settlementService;
    }

    @Operation(summary = "分期试算", description = "不落库、不产生资金状态；返回 previewToken 供提交复用。")
    @PostMapping("/preview")
    public PreviewService.PreviewResult preview(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @Valid @RequestBody PreviewRequest request) {
        requirePrincipal(principal);
        return previewService.preview(new PreviewService.PreviewCommand(request.accountId(),
                request.sourceType(), request.sourceId(), request.principal(), request.termMonths()));
    }

    @Operation(summary = "创建分期", description = "201 创建成功；同一 idempotencyKey 重放返回 200 与首次计划。")
    @PostMapping
    public ResponseEntity<CreateResponse> create(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @Valid @RequestBody CreateRequest request) {
        requirePrincipal(principal);
        InstallmentApplicationService.CreateResult result = applicationService.create(principal,
                new InstallmentApplicationService.CreateCommand(request.accountId(), request.sourceType(),
                        request.sourceId(), request.principal(), request.termMonths(), request.previewToken(),
                        request.agreementAccepted(), request.idempotencyKey()));
        InstallmentPlan plan = result.plan();
        CreateResponse body = new CreateResponse(plan.getPlanId(), plan.getStatus().name(), plan.getPrincipal(),
                plan.getTermMonths(), plan.getTotalFee(), plan.getCreatedAt());
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(body);
    }

    @Operation(summary = "我的分期列表", description = "page >= 1，size 1..100，status 仅 ACTIVE/SETTLED/CANCELLED。")
    @GetMapping
    public InstallmentQueryService.PlanPage list(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @RequestParam String accountId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        requirePrincipal(principal);
        return queryService.list(principal, accountId, status, page, size);
    }

    @Operation(summary = "分期详情", description = "含还款计划；越权一律 404。")
    @GetMapping("/{planId}")
    public InstallmentQueryService.PlanView detail(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @PathVariable String planId) {
        requirePrincipal(principal);
        return queryService.detail(principal, planId);
    }

    @Operation(summary = "提前结清",
            description = "同一 settlementIdempotencyKey 重放返回 200 首次结果；不同新键对已结清计划返回 409。")
    @PostMapping("/{planId}/early-settlement")
    public SettlementResponse settle(
            @RequestAttribute(name = InstallmentPrincipal.ATTRIBUTE, required = false) InstallmentPrincipal principal,
            @PathVariable String planId,
            @Valid @RequestBody SettlementRequest request) {
        requirePrincipal(principal);
        SettlementService.SettlementResult result = settlementService.settle(principal,
                new SettlementService.SettlementCommand(planId, request.settlementIdempotencyKey(),
                        request.feeRebate()));
        return new SettlementResponse(result.plan().getPlanId(), result.plan().getStatus().name(),
                result.quote().remainingPrincipal(), result.quote().penaltyFee(), result.quote().feeRebate(),
                result.quote().settlementTotal(), result.replayed());
    }

    private static void requirePrincipal(InstallmentPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("A valid IAM token is required.");
        }
    }
}
