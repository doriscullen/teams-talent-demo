package com.carddemo.installment.application.port;

import java.math.BigDecimal;
import java.util.List;

/** 会计分录端口（A-04）。ledger 形态可内聚也可独立，但对分期服务是真实可停用的下游。 */
public interface LedgerPort {

    record JournalLine(String accountCode, String direction, BigDecimal amount, String memo) {
    }

    /**
     * 按 entryGroupId 幂等过账：同一分组重复提交不会产生第二组分录。
     */
    void postGroup(String entryGroupId, String businessType, String referenceId, List<JournalLine> lines);
}
