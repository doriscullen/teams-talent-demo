package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 创建意图（A-002）：跨服务建计划必须有一个先落库的稳定作用单元。
 * <p>
 * ledger 过账与本地建计划共用本意图记录的 {@code planId}（因此 entryGroupId 稳定）：
 * ledger 已提交但响应丢失，或过账成功后本地事务失败，都能凭同一意图续跑而不产生第二组有效分录；
 * 无法继续时置 FAILED 并以同一 planId 冲正（REVERSAL），不留无计划的有效入账。
 */
@Entity
@Table(name = "installment_application_intent")
public class InstallmentApplicationIntent {

    public static final String PENDING = "PENDING";
    public static final String LEDGER_POSTED = "LEDGER_POSTED";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";
    public static final String REVERSED = "REVERSED";

    @Id
    @Column(name = "intent_id", length = 32, nullable = false, updatable = false)
    private String intentId;

    @Column(name = "idempotency_key", length = 64, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "account_id", length = 11, nullable = false, updatable = false)
    private String accountId;

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

    @Column(name = "plan_id", length = 32, nullable = false, updatable = false)
    private String planId;

    @Column(name = "status", length = 24, nullable = false)
    private String status;

    @Column(name = "last_error", length = 200)
    private String lastError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected InstallmentApplicationIntent() {
        // for JPA
    }

    public InstallmentApplicationIntent(String intentId, String idempotencyKey, String accountId,
                                        SourceType sourceType, String sourceId, BigDecimal principal,
                                        int termMonths, BigDecimal monthlyFeeRate, BigDecimal totalFee,
                                        String planId, LocalDateTime createdAt) {
        this.intentId = intentId;
        this.idempotencyKey = idempotencyKey;
        this.accountId = accountId;
        this.sourceType = sourceType;
        this.sourceId = sourceId;
        this.principal = principal;
        this.termMonths = termMonths;
        this.monthlyFeeRate = monthlyFeeRate;
        this.totalFee = totalFee;
        this.planId = planId;
        this.status = PENDING;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public void markLedgerPosted(LocalDateTime at) {
        this.status = LEDGER_POSTED;
        this.updatedAt = at;
    }

    public void markCompleted(LocalDateTime at) {
        this.status = COMPLETED;
        this.lastError = null;
        this.updatedAt = at;
    }

    public void markFailed(String error, LocalDateTime at) {
        this.status = FAILED;
        this.lastError = truncate(error);
        this.updatedAt = at;
    }

    /** 远端结果未知时只记录错误，保持可续跑状态（同键重试/对账补偿续跑）。 */
    public void recordError(String error, LocalDateTime at) {
        this.lastError = truncate(error);
        this.updatedAt = at;
    }

    public void markReversed(String note, LocalDateTime at) {
        this.status = REVERSED;
        this.lastError = truncate(note);
        this.updatedAt = at;
    }

    public boolean isCompleted() {
        return COMPLETED.equals(status);
    }

    public boolean isResumable() {
        return PENDING.equals(status) || LEDGER_POSTED.equals(status);
    }

    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        return message.length() <= 200 ? message : message.substring(0, 200);
    }

    public String getIntentId() {
        return intentId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public String getAccountId() {
        return accountId;
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

    public String getPlanId() {
        return planId;
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
