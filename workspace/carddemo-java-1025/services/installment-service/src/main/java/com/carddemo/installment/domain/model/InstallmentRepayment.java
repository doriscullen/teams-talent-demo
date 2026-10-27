package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 一期还款（A-003）：真实还款先经 account-service 扣减欠款（effectId = paymentKey），
 * 再回写计划的剩余本金与还款计划行；paymentKey 幂等，重复提交不重复扣款、不重复回写。
 */
@Entity
@Table(name = "installment_repayment")
public class InstallmentRepayment {

    public static final String PENDING = "PENDING";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";

    @Id
    @Column(name = "payment_key", length = 64, nullable = false, updatable = false)
    private String paymentKey;

    @Column(name = "plan_id", length = 32, nullable = false, updatable = false)
    private String planId;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "principal_applied", nullable = false, precision = 12, scale = 2)
    private BigDecimal principalApplied;

    @Column(name = "status", length = 24, nullable = false)
    private String status;

    @Column(name = "last_error", length = 200)
    private String lastError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected InstallmentRepayment() {
        // for JPA
    }

    public InstallmentRepayment(String paymentKey, String planId, BigDecimal amount, LocalDateTime createdAt) {
        this.paymentKey = paymentKey;
        this.planId = planId;
        this.amount = amount;
        this.principalApplied = BigDecimal.ZERO.setScale(2);
        this.status = PENDING;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    /**
     * 重试进入在途（A-R003a）：在计划锁事务内先原子持久化为 PENDING，提交后结清与其它还款键
     * 的栅栏立即可见，重试者才被允许执行账户/账务动作。
     */
    public void markInFlight(LocalDateTime at) {
        this.status = PENDING;
        this.updatedAt = at;
    }

    public void markCompleted(BigDecimal principalApplied, LocalDateTime at) {
        this.principalApplied = principalApplied;
        this.status = COMPLETED;
        this.lastError = null;
        this.updatedAt = at;
    }

    /** 结果未知（超时/5xx）时只记录错误，保持 PENDING 可续跑，同时阻止结清按旧本金付款。 */
    public void recordError(String error, LocalDateTime at) {
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 200));
        this.updatedAt = at;
    }

    public void markFailed(String error, LocalDateTime at) {
        this.status = FAILED;
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 200));
        this.updatedAt = at;
    }

    public boolean isCompleted() {
        return COMPLETED.equals(status);
    }

    public String getPaymentKey() {
        return paymentKey;
    }

    public String getPlanId() {
        return planId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public BigDecimal getPrincipalApplied() {
        return principalApplied;
    }

    public String getStatus() {
        return status;
    }

    public String getLastError() {
        return lastError;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
