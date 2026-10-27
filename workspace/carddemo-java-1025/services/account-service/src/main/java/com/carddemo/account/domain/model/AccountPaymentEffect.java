package com.carddemo.account.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 还款作用记录（A-001）：账户端还款效果去重。
 * <p>
 * 调用方（分期结清/一期还款）按稳定 effectId 提交；即使远端已成功但响应丢失，
 * 同 effectId 重试也只会返回首次结果，不会二次扣减余额。
 */
@Entity
@Table(name = "account_payment_effect")
public class AccountPaymentEffect {

    @Id
    @Column(name = "effect_id", length = 64, nullable = false, updatable = false)
    private String effectId;

    @Column(name = "account_id", length = 11, nullable = false, updatable = false)
    private String accountId;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "balance_after", precision = 12, scale = 2)
    private BigDecimal balanceAfter;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected AccountPaymentEffect() {
        // for JPA
    }

    public AccountPaymentEffect(String effectId, String accountId, BigDecimal amount, LocalDateTime createdAt) {
        this.effectId = effectId;
        this.accountId = accountId;
        this.amount = amount;
        this.createdAt = createdAt;
    }

    public void markApplied(BigDecimal balanceAfter) {
        this.balanceAfter = balanceAfter;
    }

    public String getEffectId() {
        return effectId;
    }

    public String getAccountId() {
        return accountId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public BigDecimal getBalanceAfter() {
        return balanceAfter;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
