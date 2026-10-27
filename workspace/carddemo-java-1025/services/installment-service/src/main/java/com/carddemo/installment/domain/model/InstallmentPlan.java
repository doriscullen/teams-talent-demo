package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 分期计划聚合根（原文 §8.1 installment_plan）。
 * BR-INS-05/10：剩余本金是唯一占用口径；结清只做一次资金动作。
 */
@Entity
@Table(name = "installment_plan")
public class InstallmentPlan {

    @Id
    @Column(name = "plan_id", length = 32, nullable = false, updatable = false)
    private String planId;

    @Column(name = "account_id", length = 11, nullable = false, updatable = false)
    private String accountId;

    @Column(name = "customer_id", length = 9)
    private String customerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", length = 16, nullable = false, updatable = false)
    private SourceType sourceType;

    @Column(name = "source_id", length = 32, nullable = false, updatable = false)
    private String sourceId;

    @Column(name = "principal", nullable = false, precision = 12, scale = 2)
    private BigDecimal principal;

    @Column(name = "term_months", nullable = false)
    private int termMonths;

    @Column(name = "monthly_fee_rate", nullable = false, precision = 6, scale = 4)
    private BigDecimal monthlyFeeRate;

    @Column(name = "total_fee", nullable = false, precision = 12, scale = 2)
    private BigDecimal totalFee;

    @Column(name = "remaining_principal", nullable = false, precision = 12, scale = 2)
    private BigDecimal remainingPrincipal;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private PlanStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "settled_at")
    private LocalDateTime settledAt;

    @Column(name = "idempotency_key", length = 64, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "settlement_idempotency_key", length = 64)
    private String settlementIdempotencyKey;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected InstallmentPlan() {
        // for JPA
    }

    public InstallmentPlan(String planId, String accountId, String customerId, SourceType sourceType,
                           String sourceId, BigDecimal principal, int termMonths, BigDecimal monthlyFeeRate,
                           BigDecimal totalFee, String idempotencyKey, LocalDateTime createdAt) {
        this.planId = planId;
        this.accountId = accountId;
        this.customerId = customerId;
        this.sourceType = sourceType;
        this.sourceId = sourceId;
        this.principal = principal;
        this.termMonths = termMonths;
        this.monthlyFeeRate = monthlyFeeRate;
        this.totalFee = totalFee;
        this.remainingPrincipal = principal;
        this.status = PlanStatus.ACTIVE;
        this.idempotencyKey = idempotencyKey;
        this.createdAt = createdAt;
        this.version = 0;
    }

    public boolean isActive() {
        return status == PlanStatus.ACTIVE;
    }

    /** 创建即 ACTIVE（BR-INS-04 语义：计划一旦生效即占用本金）。 */
    public void requireActive() {
        if (!isActive()) {
            throw new IllegalStateException("plan is not active: " + planId);
        }
    }

    /**
     * 提前结清（BR-INS-12）：本金归零、置 SETTLED 并记录幂等键。调用方保证资金动作只发生一次。
     */
    public void settle(String settlementKey, LocalDateTime settledAt) {
        this.remainingPrincipal = BigDecimal.ZERO.setScale(2);
        this.status = PlanStatus.SETTLED;
        this.settledAt = settledAt;
        this.settlementIdempotencyKey = settlementKey;
    }

    /** 还款回写：按实际归还本金减少剩余本金，不重复释放。 */
    public void repayPrincipal(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("repayment amount must be positive");
        }
        if (amount.compareTo(remainingPrincipal) > 0) {
            throw new IllegalArgumentException("repayment exceeds remaining principal");
        }
        this.remainingPrincipal = remainingPrincipal.subtract(amount);
    }

    public void cancel() {
        if (status != PlanStatus.ACTIVE) {
            throw new IllegalStateException("only ACTIVE plans can be cancelled");
        }
        this.status = PlanStatus.CANCELLED;
    }

    public String getPlanId() {
        return planId;
    }

    public String getAccountId() {
        return accountId;
    }

    public String getCustomerId() {
        return customerId;
    }

    public SourceType getSourceType() {
        return sourceType;
    }

    public String getSourceId() {
        return sourceId;
    }

    public BigDecimal getPrincipal() {
        return principal;
    }

    public int getTermMonths() {
        return termMonths;
    }

    public BigDecimal getMonthlyFeeRate() {
        return monthlyFeeRate;
    }

    public BigDecimal getTotalFee() {
        return totalFee;
    }

    public BigDecimal getRemainingPrincipal() {
        return remainingPrincipal;
    }

    public PlanStatus getStatus() {
        return status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getSettledAt() {
        return settledAt;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public String getSettlementIdempotencyKey() {
        return settlementIdempotencyKey;
    }

    public long getVersion() {
        return version;
    }
}
