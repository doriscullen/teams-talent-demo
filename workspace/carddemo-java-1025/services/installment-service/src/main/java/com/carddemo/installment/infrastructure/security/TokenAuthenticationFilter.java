package com.carddemo.installment.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 分期接口的鉴权入口（AC-14）：无 token / 签名非法 / 过期统一 401，
 * 校验通过后把真实主体写入请求属性，业务层不再信任请求体中的身份字段。
 */
@Component
public class TokenAuthenticationFilter extends OncePerRequestFilter {

    private static final String PROTECTED_PREFIX = "/api/v1/installments";
    private static final String ADMIN_PREFIX = "/api/v1/admin/installments";
    private static final String UNAUTHORIZED_BODY =
            "{\"code\":\"UNAUTHENTICATED\",\"message\":\"A valid IAM token is required\"}";

    private final HmacTokenVerifier verifier;

    public TokenAuthenticationFilter(HmacTokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !(path.startsWith(PROTECTED_PREFIX) || path.startsWith(ADMIN_PREFIX));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        var verified = verifier.verify(header);
        if (verified.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write(UNAUTHORIZED_BODY);
            return;
        }
        var token = verified.get();
        request.setAttribute(InstallmentPrincipal.ATTRIBUTE,
                new InstallmentPrincipal(token.userId(), token.userType()));
        chain.doFilter(request, response);
    }
}
