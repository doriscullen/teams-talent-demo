package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 逾期/争议信号（基线缺失，由本设计补齐，AC-17）。由后台维护，分期入口与提交据此拒绝。
 */
@Entity
@Table(name = "installment_eligibility_flag")
public class EligibilityFlag {

    @Id
    @Column(name = "transaction_id", length = 16, nullable = false, updatable = false)
    private String transactionId;

    @Column(name = "disputed", nullable = false)
    private boolean disputed;

    @Column(name = "delinquent", nullable = false)
    private boolean delinquent;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected EligibilityFlag() {
        // for JPA
    }

    public EligibilityFlag(String transactionId, boolean disputed, boolean delinquent, LocalDateTime updatedAt) {
        this.transactionId = transactionId;
        this.disputed = disputed;
        this.delinquent = delinquent;
        this.updatedAt = updatedAt;
    }

    public void update(boolean disputed, boolean delinquent, LocalDateTime updatedAt) {
        this.disputed = disputed;
        this.delinquent = delinquent;
        this.updatedAt = updatedAt;
    }

    public String getTransactionId() {
        return transactionId;
    }

    public boolean isDisputed() {
        return disputed;
    }

    public boolean isDelinquent() {
        return delinquent;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
