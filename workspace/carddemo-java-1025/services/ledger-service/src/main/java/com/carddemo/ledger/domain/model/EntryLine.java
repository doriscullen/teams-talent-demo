package com.carddemo.ledger.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/** 分录行：借/贷、科目、金额。 */
@Entity
@Table(name = "ledger_entry_line")
public class EntryLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "line_id")
    private Long lineId;

    @Column(name = "entry_group_id", length = 64, nullable = false)
    private String entryGroupId;

    @Column(name = "account_code", length = 40, nullable = false)
    private String accountCode;

    @Column(name = "direction", length = 8, nullable = false)
    private String direction;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "memo", length = 120)
    private String memo;

    protected EntryLine() {
        // for JPA
    }

    public EntryLine(String entryGroupId, String accountCode, String direction, BigDecimal amount, String memo) {
        this.entryGroupId = entryGroupId;
        this.accountCode = accountCode;
        this.direction = direction;
        this.amount = amount;
        this.memo = memo;
    }

    public Long getLineId() {
        return lineId;
    }

    public String getEntryGroupId() {
        return entryGroupId;
    }

    public String getAccountCode() {
        return accountCode;
    }

    public String getDirection() {
        return direction;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getMemo() {
        return memo;
    }
}
