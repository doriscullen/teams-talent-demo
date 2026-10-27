package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 单账户并发闸门（BR-INS-11）：计数与创建在同一持锁事务内完成。 */
@Entity
@Table(name = "installment_account_lock")
public class AccountLockRow {

    @Id
    @Column(name = "account_id", length = 11, nullable = false, updatable = false)
    private String accountId;

    protected AccountLockRow() {
        // for JPA
    }

    public String getAccountId() {
        return accountId;
    }
}
