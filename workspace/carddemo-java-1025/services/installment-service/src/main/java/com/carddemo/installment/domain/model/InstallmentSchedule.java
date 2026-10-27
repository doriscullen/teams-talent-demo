package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 还款计划行（原文 §8.1 installment_schedule）。Σprincipal_due = principal，Σtotal_due = principal + total_fee。 */
@Entity
@Table(name = "installment_schedule")
public class InstallmentSchedule {

    @Id
    @Column(name = "schedule_id", length = 40, nullable = false, updatable = false)
    private String scheduleId;

    @Column(name = "plan_id", length = 32, nullable = false, updatable = false)
    private String planId;

    @Column(name = "installment_no", nullable = false)
    private int installmentNo;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    @Column(name = "principal_due", nullable = false, precision = 12, scale = 2)
    private BigDecimal principalDue;

    @Column(name = "fee_due", nullable = false, precision = 12, scale = 2)
    private BigDecimal feeDue;

    @Column(name = "total_due", nullable = false, precision = 12, scale = 2)
    private BigDecimal totalDue;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private ScheduleStatus status;

    @Column(name = "paid_at")
    private LocalDateTime paidAt;

    protected InstallmentSchedule() {
        // for JPA
    }

    public InstallmentSchedule(String scheduleId, String planId, int installmentNo, LocalDate dueDate,
                               BigDecimal principalDue, BigDecimal feeDue) {
        this.scheduleId = scheduleId;
        this.planId = planId;
        this.installmentNo = installmentNo;
        this.dueDate = dueDate;
        this.principalDue = principalDue;
        this.feeDue = feeDue;
        this.totalDue = principalDue.add(feeDue);
        this.status = ScheduleStatus.PENDING;
    }

    public void markPaid(LocalDateTime paidAt) {
        if (status == ScheduleStatus.PAID) {
            throw new IllegalStateException("schedule already paid");
        }
        this.status = ScheduleStatus.PAID;
        this.paidAt = paidAt;
    }

    public String getScheduleId() {
        return scheduleId;
    }

    public String getPlanId() {
        return planId;
    }

    public int getInstallmentNo() {
        return installmentNo;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public BigDecimal getPrincipalDue() {
        return principalDue;
    }

    public BigDecimal getFeeDue() {
        return feeDue;
    }

    public BigDecimal getTotalDue() {
        return totalDue;
    }

    public ScheduleStatus getStatus() {
        return status;
    }

    public LocalDateTime getPaidAt() {
        return paidAt;
    }
}
