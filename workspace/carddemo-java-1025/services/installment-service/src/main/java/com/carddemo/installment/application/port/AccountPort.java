package com.carddemo.installment.application.port;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 账户上下文端口（A-03：余额变更必须经 account-service）。 */
public interface AccountPort {

    record AccountSnapshot(String accountId, String activeStatus, BigDecimal currentBalance,
                           BigDecimal creditLimit, LocalDate openDate) {
    }

    AccountSnapshot getAccount(String accountId);

    /** 真实还款（只减少欠款；返回变更后余额）。 */
    BigDecimal applyRepayment(String accountId, BigDecimal amount);
}
