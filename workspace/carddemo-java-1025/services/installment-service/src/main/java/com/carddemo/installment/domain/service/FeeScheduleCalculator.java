package com.carddemo.installment.domain.service;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 计费规则（BR-INS-03 / BR-INS-03R，test-profile-v2）：
 * <ul>
 *   <li>首 N-1 期本金 = 本金/期数 截断到 2 位；末期吸收尾差（合计恒等于本金）</li>
 *   <li>每期手续费 = 期初剩余本金 × 月费率，HALF_UP 到 2 位</li>
 * </ul>
 * 原文 §10 US-001 的 33.00 / §9 的 9.00 与本期公式冲突，已按 PRD D-01 以本公式为准，原文示例保留不改写。
 */
@Component
public class FeeScheduleCalculator {

    /** 一期还款计划：期序、本金、手续费。 */
    public record Period(int installmentNo, BigDecimal principal, BigDecimal fee) {

        public BigDecimal total() {
            return principal.add(fee);
        }
    }

    /** 完整分期计算结果。 */
    public record FeeSchedule(List<Period> periods, BigDecimal totalPrincipal, BigDecimal totalFee) {

        public BigDecimal firstPeriodTotal() {
            return periods.isEmpty() ? BigDecimal.ZERO.setScale(2) : periods.get(0).total();
        }
    }

    public FeeSchedule calculate(BigDecimal principal, int termMonths, BigDecimal monthlyFeeRate) {
        if (principal == null || principal.signum() <= 0) {
            throw new IllegalArgumentException("principal must be positive");
        }
        if (termMonths <= 0) {
            throw new IllegalArgumentException("termMonths must be positive");
        }
        if (monthlyFeeRate == null || monthlyFeeRate.signum() < 0) {
            throw new IllegalArgumentException("monthlyFeeRate must not be negative");
        }

        BigDecimal perPeriod = principal.divide(BigDecimal.valueOf(termMonths), 2, RoundingMode.DOWN);
        BigDecimal allocated = perPeriod.multiply(BigDecimal.valueOf(termMonths - 1L));
        BigDecimal lastPeriod = principal.subtract(allocated).setScale(2, RoundingMode.UNNECESSARY);

        List<Period> periods = new ArrayList<>(termMonths);
        BigDecimal remaining = principal;
        BigDecimal totalFee = BigDecimal.ZERO.setScale(2);
        for (int no = 1; no <= termMonths; no++) {
            BigDecimal periodPrincipal = no < termMonths ? perPeriod : lastPeriod;
            BigDecimal fee = remaining.multiply(monthlyFeeRate).setScale(2, RoundingMode.HALF_UP);
            periods.add(new Period(no, periodPrincipal, fee));
            remaining = remaining.subtract(periodPrincipal);
            totalFee = totalFee.add(fee);
        }
        return new FeeSchedule(List.copyOf(periods), principal, totalFee);
    }
}
