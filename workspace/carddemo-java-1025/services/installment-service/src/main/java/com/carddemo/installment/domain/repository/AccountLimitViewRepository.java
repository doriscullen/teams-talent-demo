package com.carddemo.installment.domain.repository;

import java.math.BigDecimal;

/**
 * 账户额度视图（原文 §8.1）：{@code installment_occupied} 直接从 {@code installment_plan} 聚合，
 * 不另存一份可漂移的展示字段。
 */
public interface AccountLimitViewRepository {

    record Occupancy(BigDecimal installmentOccupied, long activePlanCount) {
    }

    /** 无生效计划的账户返回 0.00 / 0。 */
    Occupancy findOccupancy(String accountId);
}
