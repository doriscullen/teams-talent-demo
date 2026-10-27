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
 * 步骤状态使 ledger 过账与真实还款都可凭同一意图续跑（A-001）。
 */
@Entity
@Table(name = "installment_settlement_intent")
public class SettlementIntent {

    public static final String PENDING = "PENDING";
    public static final String LEDGER_POSTED = "LEDGER_POSTED";
    public static final String PAYMENT_APPLIED = "PAYMENT_APPLIED";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";

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

    @Column(name = "last_error", length = 200)
    private String lastError;

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
        this.lastError = null;
        this.updatedAt = at;
    }

    public void markPaymentApplied(LocalDateTime at) {
        this.status = PAYMENT_APPLIED;
        this.lastError = null;
        this.updatedAt = at;
    }

    public void markCompleted(LocalDateTime at) {
        this.status = COMPLETED;
        this.lastError = null;
        this.updatedAt = at;
    }

    public void markFailed(String error, LocalDateTime at) {
        this.status = FAILED;
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 200));
        this.updatedAt = at;
    }

    /** 结果未知（超时/5xx）时只记录错误，保持可续跑状态。 */
    public void recordError(String error, LocalDateTime at) {
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 200));
        this.updatedAt = at;
    }

    public boolean isFailed() {
        return FAILED.equals(status);
    }

    /** 重放时校验键内容：同键不同金额/计划视为冲突，不返回首次结果也不重复付款。 */
    public boolean matchesContent(String planId, BigDecimal principal, BigDecimal penalty, BigDecimal rebate,
                                  BigDecimal total) {
        return this.planId.equals(planId)
                && this.principal.compareTo(principal) == 0
                && this.penaltyFee.compareTo(penalty) == 0
                && this.feeRebate.compareTo(rebate) == 0
                && this.amount.compareTo(total) == 0;
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

    public String getLastError() {
        return lastError;
    }

    public boolean isCompleted() {
        return COMPLETED.equals(status);
    }
}
