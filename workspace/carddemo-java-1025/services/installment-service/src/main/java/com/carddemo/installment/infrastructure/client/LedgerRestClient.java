package com.carddemo.installment.infrastructure.client;

import com.carddemo.installment.application.port.LedgerPort;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;
import java.util.Map;

/** ledger-service 客户端（ADR-010）：按 entryGroupId 幂等过账，服务不可用即 503。 */
@Component
public class LedgerRestClient implements LedgerPort {

    private final RestClient restClient;

    public LedgerRestClient(@Value("${installment.downstream.ledger-url}") String baseUrl,
                            @Value("${installment.downstream.connect-timeout-ms:500}") long connectTimeoutMs,
                            @Value("${installment.downstream.read-timeout-ms:2000}") long readTimeoutMs) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(HttpClientSupport.requestFactory(connectTimeoutMs, readTimeoutMs))
                .build();
    }

    @Override
    public void postGroup(String entryGroupId, String businessType, String referenceId, List<JournalLine> lines) {
        List<Map<String, Object>> payloadLines = lines.stream()
                .map(line -> Map.<String, Object>of(
                        "accountCode", line.accountCode(),
                        "direction", line.direction(),
                        "amount", line.amount(),
                        "memo", line.memo() == null ? "" : line.memo()))
                .toList();
        Map<String, Object> payload = Map.of(
                "entryGroupId", entryGroupId,
                "businessType", businessType,
                "referenceId", referenceId,
                "lines", payloadLines);
        try {
            restClient.post()
                    .uri("/api/v1/journal-entries")
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientException ex) {
            throw new RemoteServiceException("ledger-service", "Ledger posting failed for " + entryGroupId, ex);
        }
    }
}
