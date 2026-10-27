package com.carddemo.installment.infrastructure.client;

import org.springframework.http.client.JdkClientHttpRequestFactory;

import java.net.http.HttpClient;
import java.time.Duration;

/** 统一的下游 HTTP 超时配置（超时即 503，由业务层回滚）。 */
public final class HttpClientSupport {

    private HttpClientSupport() {
    }

    public static JdkClientHttpRequestFactory requestFactory(long connectTimeoutMs, long readTimeoutMs) {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        return factory;
    }
}
