package com.carddemo.installment.application.port;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/** 交易上下文端口（A-01：资格来源是 transaction-service 的真实交易）。 */
public interface TransactionPort {

    record TransactionView(String transactionId, String accountId, String cardNumber, String typeCode,
                           String categoryCode, String description, BigDecimal amount,
                           LocalDateTime processedTimestamp, String status) {

        public boolean isPurchase() {
            return "01".equals(typeCode);
        }
    }

    Optional<TransactionView> findTransaction(String transactionId);

    List<TransactionView> listAccountTransactions(String accountId, int page, int size);
}
