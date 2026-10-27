package com.carddemo.installment.infrastructure.client;

import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** transaction-service 客户端：分期资格与账单来源都来自真实交易数据（A-01）。 */
@Component
public class TransactionRestClient implements TransactionPort {

    private final RestClient restClient;

    public TransactionRestClient(@Value("${installment.downstream.transaction-url}") String baseUrl,
                                 @Value("${installment.downstream.connect-timeout-ms:500}") long connectTimeoutMs,
                                 @Value("${installment.downstream.read-timeout-ms:2000}") long readTimeoutMs) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(HttpClientSupport.requestFactory(connectTimeoutMs, readTimeoutMs))
                .build();
    }

    @Override
    public Optional<TransactionView> findTransaction(String transactionId) {
        try {
            Map<?, ?> body = restClient.get()
                    .uri("/api/v1/transactions/{transactionId}", transactionId)
                    .retrieve()
                    .body(Map.class);
            return Optional.ofNullable(body).map(TransactionRestClient::toView);
        } catch (org.springframework.web.client.HttpClientErrorException.NotFound ex) {
            return Optional.empty();
        } catch (RestClientException ex) {
            throw new RemoteServiceException("transaction-service", "Transaction lookup failed", ex);
        }
    }

    @Override
    public List<TransactionView> listAccountTransactions(String accountId, int page, int size) {
        try {
            Map<?, ?> body = restClient.get()
                    .uri(uri -> uri.path("/api/v1/transactions")
                            .queryParam("accountId", accountId)
                            .queryParam("page", page)
                            .queryParam("size", size)
                            .build())
                    .retrieve()
                    .body(Map.class);
            if (body == null || !(body.get("items") instanceof List<?> items)) {
                return List.of();
            }
            List<TransactionView> views = new ArrayList<>(items.size());
            for (Object item : items) {
                if (item instanceof Map<?, ?> map) {
                    views.add(toView(map));
                }
            }
            return views;
        } catch (RestClientException ex) {
            throw new RemoteServiceException("transaction-service", "Transaction list failed", ex);
        }
    }

    private static TransactionView toView(Map<?, ?> body) {
        return new TransactionView(
                String.valueOf(body.get("transactionId")),
                String.valueOf(body.get("accountId")),
                body.get("cardNumber") == null ? null : String.valueOf(body.get("cardNumber")),
                String.valueOf(body.get("typeCode")),
                String.valueOf(body.get("categoryCode")),
                body.get("description") == null ? "" : String.valueOf(body.get("description")),
                decimal(body.get("amount")),
                LocalDateTime.parse(String.valueOf(body.get("processedTimestamp"))),
                String.valueOf(body.get("status")));
    }

    private static BigDecimal decimal(Object value) {
        return value == null ? null : new BigDecimal(String.valueOf(value));
    }
}
