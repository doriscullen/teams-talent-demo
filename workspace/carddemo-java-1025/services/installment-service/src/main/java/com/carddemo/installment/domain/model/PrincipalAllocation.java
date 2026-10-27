package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/**
 * 本金级去重记录（BR-INS-09）：一笔已入账交易的本金只能被占用一次，
 * 单笔分期与账单分期共用同一张表，因此两个方向都无法重复占用。
 */
@Entity
@Table(name = "installment_principal_allocation")
public class PrincipalAllocation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "allocation_id")
    private Long allocationId;

    @Column(name = "plan_id", length = 32, nullable = false)
    private String planId;

    @Column(name = "transaction_id", length = 16, nullable = false)
    private String transactionId;

    @Column(name = "principal_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal principalAmount;

    protected PrincipalAllocation() {
        // for JPA
    }

    public PrincipalAllocation(String planId, String transactionId, BigDecimal principalAmount) {
        this.planId = planId;
        this.transactionId = transactionId;
        this.principalAmount = principalAmount;
    }

    public Long getAllocationId() {
        return allocationId;
    }

    public String getPlanId() {
        return planId;
    }

    public String getTransactionId() {
        return transactionId;
    }

    public BigDecimal getPrincipalAmount() {
        return principalAmount;
    }
}
