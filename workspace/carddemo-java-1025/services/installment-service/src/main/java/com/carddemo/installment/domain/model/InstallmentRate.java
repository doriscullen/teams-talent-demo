package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/** 期数 → 月手续费率（BR-INS-02：0.60%/0.55%/0.50%）。 */
@Entity
@Table(name = "installment_rate")
public class InstallmentRate {

    @Id
    @Column(name = "term_months")
    private int termMonths;

    @Column(name = "monthly_fee_rate", nullable = false, precision = 6, scale = 4)
    private BigDecimal monthlyFeeRate;

    protected InstallmentRate() {
        // for JPA
    }

    public int getTermMonths() {
        return termMonths;
    }

    public BigDecimal getMonthlyFeeRate() {
        return monthlyFeeRate;
    }
}
