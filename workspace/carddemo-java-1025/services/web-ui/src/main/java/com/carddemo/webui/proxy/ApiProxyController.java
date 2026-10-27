package com.carddemo.webui.proxy;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import jakarta.servlet.http.HttpServletRequest;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 同源 API 代理：浏览器只访问 8080，由本服务按路径前缀转发到对应微服务。
 * 这样前端不需要 CORS，也不需要知道每个微服务的端口。
 */
@RestController
public class ApiProxyController {

    private static final String ROUTE_NOT_FOUND =
            "{\"code\":\"ROUTE_NOT_FOUND\",\"message\":\"No upstream service is mapped to this path\"}";
    private static final String UPSTREAM_UNAVAILABLE =
            "{\"code\":\"DEPENDENCY_UNAVAILABLE\",\"message\":\"Upstream service is unavailable\"}";

    private final Map<String, String> routes = new LinkedHashMap<>();
    private final RestClient restClient;

    public ApiProxyController(
            @Value("${proxy.iam-service-url}") String iamServiceUrl,
            @Value("${proxy.customer-service-url}") String customerServiceUrl,
            @Value("${proxy.card-service-url}") String cardServiceUrl,
            @Value("${proxy.account-service-url}") String accountServiceUrl,
            @Value("${proxy.transaction-service-url}") String transactionServiceUrl,
            @Value("${proxy.authorization-service-url}") String authorizationServiceUrl,
            @Value("${proxy.marketing-service-url}") String marketingServiceUrl,
            @Value("${proxy.installment-service-url}") String installmentServiceUrl) {
        routes.put("/api/v1/auth", iamServiceUrl);
        routes.put("/api/v1/users", iamServiceUrl);
        routes.put("/api/v1/customers", customerServiceUrl);
        routes.put("/api/v1/cards", cardServiceUrl);
        routes.put("/api/v1/accounts", accountServiceUrl);
        routes.put("/api/v1/transactions", transactionServiceUrl);
        routes.put("/api/v1/postings", transactionServiceUrl);
        routes.put("/api/v1/bill-payments", transactionServiceUrl);
        routes.put("/api/v1/interest-runs", transactionServiceUrl);
        routes.put("/api/v1/reports", transactionServiceUrl);
        routes.put("/api/v1/transaction-types", transactionServiceUrl);
        routes.put("/api/v1/transaction-categories", transactionServiceUrl);
        routes.put("/api/v1/authorizations", authorizationServiceUrl);
        routes.put("/api/v1/pending-authorizations", authorizationServiceUrl);
        routes.put("/api/v1/authorization-purges", authorizationServiceUrl);
        routes.put("/api/v1/campaigns", marketingServiceUrl);
        routes.put("/api/v1/eligibilities", marketingServiceUrl);
        routes.put("/api/v1/reward-evaluations", marketingServiceUrl);
        routes.put("/api/v1/rewards", marketingServiceUrl);
        routes.put("/api/v1/marketing", marketingServiceUrl);
        routes.put("/api/v1/installments", installmentServiceUrl);
        routes.put("/api/v1/admin/installments", installmentServiceUrl);

        this.restClient = RestClient.builder()
                .requestFactory(requestFactory())
                .build();
    }

    @RequestMapping("/api/**")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request,
                                       @RequestBody(required = false) byte[] body) {
        String target = resolveTarget(request.getRequestURI());
        if (target == null) {
            return json(HttpStatus.NOT_FOUND, ROUTE_NOT_FOUND);
        }

        String query = request.getQueryString();
        String url = target + request.getRequestURI() + (query == null ? "" : "?" + query);

        try {
            RestClient.RequestBodySpec spec = restClient
                    .method(HttpMethod.valueOf(request.getMethod()))
                    .uri(URI.create(url));
            copyHeader(request, spec, HttpHeaders.CONTENT_TYPE);
            copyHeader(request, spec, HttpHeaders.ACCEPT);
            copyHeader(request, spec, HttpHeaders.AUTHORIZATION);
            copyHeader(request, spec, "X-User-Id");
            if (body != null && body.length > 0) {
                spec.body(body);
            }
            return spec.exchange((clientRequest, clientResponse) -> {
                HttpHeaders headers = new HttpHeaders();
                String contentType = clientResponse.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE);
                if (contentType != null) {
                    headers.set(HttpHeaders.CONTENT_TYPE, contentType);
                }
                byte[] payload = clientResponse.getBody().readAllBytes();
                return new ResponseEntity<>(payload, headers, clientResponse.getStatusCode());
            });
        } catch (ResourceAccessException ex) {
            return json(HttpStatus.SERVICE_UNAVAILABLE, UPSTREAM_UNAVAILABLE);
        } catch (RestClientException ex) {
            return json(HttpStatus.BAD_GATEWAY,
                    "{\"code\":\"UPSTREAM_ERROR\",\"message\":\"Upstream request failed\"}");
        }
    }

    String resolveTarget(String path) {
        for (Map.Entry<String, String> route : routes.entrySet()) {
            if (path.equals(route.getKey()) || path.startsWith(route.getKey() + "/")) {
                return route.getValue();
            }
        }
        return null;
    }

    private static org.springframework.http.client.JdkClientHttpRequestFactory requestFactory() {
        org.springframework.http.client.JdkClientHttpRequestFactory factory =
                new org.springframework.http.client.JdkClientHttpRequestFactory();
        factory.setReadTimeout(Duration.ofSeconds(30));
        return factory;
    }

    private static void copyHeader(HttpServletRequest request,
                                   RestClient.RequestBodySpec spec,
                                   String name) {
        Enumeration<String> values = request.getHeaders(name);
        while (values.hasMoreElements()) {
            spec.header(name, values.nextElement());
        }
    }

    private static ResponseEntity<byte[]> json(HttpStatus status, String body) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body.getBytes(StandardCharsets.UTF_8));
    }
}
