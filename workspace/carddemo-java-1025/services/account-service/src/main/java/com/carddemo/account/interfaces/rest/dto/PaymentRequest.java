package com.carddemo.account.interfaces.rest.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * 还款请求（A-001）。effectId 是调用方的稳定作用标识：
 * 同一 effectId 重复提交只产生一次扣款并返回首次结果；不带 effectId 时保持原有非幂等语义。
 */
public record PaymentRequest(
        @Schema(description = "还款金额（不得大于当前欠款）", example = "300.00",
                requiredMode = Schema.RequiredMode.REQUIRED)
        @NotNull(message = "Amount must be supplied.")
        @DecimalMin(value = "0.00", message = "Amount must not be negative.")
        BigDecimal amount,

        @Schema(description = "调用方稳定作用标识（可选；提供时按此幂等）", example = "SETTLE-abc123")
        @Size(max = 64, message = "effectId must not exceed 64 characters.")
        String effectId) {
}
