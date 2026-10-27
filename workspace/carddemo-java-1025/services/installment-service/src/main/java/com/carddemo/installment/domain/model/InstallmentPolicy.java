package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 分期策略参数（BR-INS-01/07/11/14）。所有阈值来自配置表，不硬编码在代码里。
 */
@Entity
@Table(name = "installment_policy")
public class InstallmentPolicy {

    @Id
    @Column(name = "id")
    private Short id;

    @Column(name = "min_transaction_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal minTransactionAmount;

    @Column(name = "min_bill_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal minBillAmount;

    @Column(name = "max_active_plans_per_account", nullable = false)
    private int maxActivePlansPerAccount;

    @Column(name = "penalty_rate", nullable = false, precision = 6, scale = 4)
    private BigDecimal penaltyRate;

    @Column(name = "preview_ttl_minutes", nullable = false)
    private int previewTtlMinutes;

    @Column(name = "idempotency_window_minutes", nullable = false)
    private int idempotencyWindowMinutes;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected InstallmentPolicy() {
        // for JPA
    }

    public BigDecimal getMinTransactionAmount() {
        return minTransactionAmount;
    }

    public BigDecimal getMinBillAmount() {
        return minBillAmount;
    }

    public int getMaxActivePlansPerAccount() {
        return maxActivePlansPerAccount;
    }

    public BigDecimal getPenaltyRate() {
        return penaltyRate;
    }

    public int getPreviewTtlMinutes() {
        return previewTtlMinutes;
    }

    public int getIdempotencyWindowMinutes() {
        return idempotencyWindowMinutes;
    }
}
