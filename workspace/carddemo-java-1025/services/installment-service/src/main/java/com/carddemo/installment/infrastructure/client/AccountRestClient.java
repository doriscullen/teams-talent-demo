package com.carddemo.installment.infrastructure.client;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;

/** account-service 客户端：读取账户与执行真实还款（A-03）。 */
@Component
public class AccountRestClient implements AccountPort {

    private final RestClient restClient;

    public AccountRestClient(@Value("${installment.downstream.account-url}") String baseUrl,
                             @Value("${installment.downstream.connect-timeout-ms:500}") long connectTimeoutMs,
                             @Value("${installment.downstream.read-timeout-ms:2000}") long readTimeoutMs) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(HttpClientSupport.requestFactory(connectTimeoutMs, readTimeoutMs))
                .build();
    }

    @Override
    public AccountSnapshot getAccount(String accountId) {
        try {
            Map<?, ?> body = restClient.get()
                    .uri("/api/v1/accounts/{accountId}", accountId)
                    .retrieve()
                    .body(Map.class);
            if (body == null) {
                throw new RemoteServiceException("account-service", "Empty account response");
            }
            return new AccountSnapshot(
                    String.valueOf(body.get("accountId")),
                    String.valueOf(body.get("activeStatus")),
                    decimal(body.get("currentBalance")),
                    decimal(body.get("creditLimit")),
                    java.time.LocalDate.parse(String.valueOf(body.get("openDate"))));
        } catch (HttpClientErrorException ex) {
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw new RemoteServiceException("account-service", "Account not found: " + accountId, ex);
            }
            throw new RemoteServiceException("account-service", "Account lookup failed", ex);
        } catch (RestClientException ex) {
            throw new RemoteServiceException("account-service", "Account service is unavailable", ex);
        }
    }

    @Override
    public BigDecimal applyRepayment(String accountId, BigDecimal amount) {
        try {
            Map<?, ?> body = restClient.post()
                    .uri("/api/v1/accounts/{accountId}/payments", accountId)
                    .body(Map.of("amount", amount))
                    .retrieve()
                    .body(Map.class);
            if (body == null) {
                throw new RemoteServiceException("account-service", "Empty payment response");
            }
            return decimal(body.get("currentBalance"));
        } catch (RestClientException ex) {
            throw new RemoteServiceException("account-service", "Repayment failed", ex);
        }
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) {
            return null;
        }
        return new BigDecimal(String.valueOf(value));
    }

    static Duration duration(long millis) {
        return Duration.ofMillis(millis);
    }
}
