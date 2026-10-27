package com.carddemo.installment.domain.service;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 提前结清试算（BR-INS-12）：违约金 = 剩余本金 × 1%（HALF_UP 2 位），
 * feeRebate 本轮默认 0.00（v2 口径；正式减免策略见 PRD §12.3-3）。
 */
@Component
public class SettlementCalculator {

    public record SettlementQuote(BigDecimal remainingPrincipal,
                                  BigDecimal penaltyFee,
                                  BigDecimal feeRebate,
                                  BigDecimal settlementTotal) {
    }

    public SettlementQuote quote(BigDecimal remainingPrincipal, BigDecimal feeRebate, BigDecimal penaltyRate) {
        if (remainingPrincipal == null || remainingPrincipal.signum() < 0) {
            throw new IllegalArgumentException("remainingPrincipal must not be negative");
        }
        BigDecimal rebate = feeRebate == null ? BigDecimal.ZERO.setScale(2) : feeRebate.setScale(2);
        BigDecimal penalty = remainingPrincipal.multiply(penaltyRate).setScale(2, RoundingMode.HALF_UP);
        BigDecimal total = remainingPrincipal.add(penalty).subtract(rebate).setScale(2, RoundingMode.HALF_UP);
        return new SettlementQuote(remainingPrincipal.setScale(2), penalty, rebate, total);
    }
}
