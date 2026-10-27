package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 提前结清幂等意图（BR-INS-14 / AC-16）：同一 settlementKey 重放返回首次结果；
 * 不同新键对非 ACTIVE 计划返回 409。金额分解一并落盘，重放不再重新试算。
 */
@Entity
@Table(name = "installment_settlement_intent")
public class SettlementIntent {

    public static final String PENDING = "PENDING";
    public static final String LEDGER_POSTED = "LEDGER_POSTED";
    public static final String COMPLETED = "COMPLETED";

    @Id
    @Column(name = "settlement_key", length = 64, nullable = false, updatable = false)
    private String settlementKey;

    @Column(name = "plan_id", length = 32, nullable = false)
    private String planId;

    @Column(name = "principal", nullable = false, precision = 12, scale = 2)
    private BigDecimal principal;

    @Column(name = "penalty_fee", nullable = false, precision = 12, scale = 2)
    private BigDecimal penaltyFee;

    @Column(name = "fee_rebate", nullable = false, precision = 12, scale = 2)
    private BigDecimal feeRebate;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "status", length = 24, nullable = false)
    private String status;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected SettlementIntent() {
        // for JPA
    }

    public SettlementIntent(String settlementKey, String planId, BigDecimal principal, BigDecimal penaltyFee,
                            BigDecimal feeRebate, BigDecimal amount, LocalDateTime updatedAt) {
        this.settlementKey = settlementKey;
        this.planId = planId;
        this.principal = principal;
        this.penaltyFee = penaltyFee;
        this.feeRebate = feeRebate;
        this.amount = amount;
        this.status = PENDING;
        this.updatedAt = updatedAt;
    }

    public void markLedgerPosted(LocalDateTime at) {
        this.status = LEDGER_POSTED;
        this.updatedAt = at;
    }

    public void markCompleted(LocalDateTime at) {
        this.status = COMPLETED;
        this.updatedAt = at;
    }

    public String getSettlementKey() {
        return settlementKey;
    }

    public String getPlanId() {
        return planId;
    }

    public BigDecimal getPrincipal() {
        return principal;
    }

    public BigDecimal getPenaltyFee() {
        return penaltyFee;
    }

    public BigDecimal getFeeRebate() {
        return feeRebate;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getStatus() {
        return status;
    }

    public boolean isCompleted() {
        return COMPLETED.equals(status);
    }
}
