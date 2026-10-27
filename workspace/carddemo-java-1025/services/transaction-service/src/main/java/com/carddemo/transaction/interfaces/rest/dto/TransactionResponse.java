package com.carddemo.transaction.interfaces.rest.dto;

import com.carddemo.transaction.application.TransactionView;
import com.carddemo.transaction.domain.model.TransactionRecord;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * GET /api/v1/transactions 与 /{transactionId} 的响应（docs/design/05-api-catalog.md §5）。
 */
public record TransactionResponse(
        String transactionId,
        String accountId,
        String cardNumber,
        String typeCode,
        String typeDescription,
        String categoryCode,
        String categoryDescription,
        String source,
        String description,
        BigDecimal amount,
        String merchantId,
        String merchantName,
        String merchantCity,
        String merchantZip,
        LocalDateTime originalTimestamp,
        LocalDateTime processedTimestamp,
        String status) {

    public static TransactionResponse from(TransactionView view) {
        TransactionRecord transaction = view.transaction();
        return new TransactionResponse(
                transaction.getTransactionId(),
                transaction.getAccountId(),
                transaction.getCardNumber(),
                transaction.getTypeCode(),
                view.typeDescription(),
                transaction.getCategoryCode(),
                view.categoryDescription(),
                transaction.getSource(),
                transaction.getDescription(),
                transaction.getAmount(),
                transaction.getMerchantId(),
                transaction.getMerchantName(),
                transaction.getMerchantCity(),
                transaction.getMerchantZip(),
                transaction.getOriginalTimestamp(),
                transaction.getProcessedTimestamp(),
                transaction.getStatus().name());
    }
}
