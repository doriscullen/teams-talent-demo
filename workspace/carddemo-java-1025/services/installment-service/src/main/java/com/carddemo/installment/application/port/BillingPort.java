package com.carddemo.installment.application.port;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 账单能力端口（A-02）。基线没有 billing 服务，本设计在分期服务内实现最小账单能力（ADR-011）。 */
public interface BillingPort {

    record BillingLine(String transactionId, BigDecimal amount, LocalDate postedDate, String description) {
    }

    record BillingStatement(String billId, String accountId, LocalDate cycleStart, LocalDate cycleEnd,
                            BigDecimal billPrincipal, BigDecimal availablePrincipal,
                            List<BillingLine> lines) {
    }

    BillingStatement currentStatement(String accountId);
}
