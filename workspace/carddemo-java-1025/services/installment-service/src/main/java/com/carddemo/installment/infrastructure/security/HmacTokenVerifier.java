package com.carddemo.installment.infrastructure.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;

/**
 * IAM HMAC token 校验（ADR-007 契约真实形状，非 JWT）：
 * token = base64url(payload) + "." + base64url(HmacSHA256(payload, secret))，payload = userId|userType|exp。
 */
@Component
public class HmacTokenVerifier {

    private static final String ALGORITHM = "HmacSHA256";

    private final byte[] secret;

    public HmacTokenVerifier(@Value("${installment.iam.token.secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public record VerifiedToken(String userId, String userType, Instant expiresAt) {
    }

    /** 校验失败返回 Optional.empty()，由调用方统一 401。 */
    public java.util.Optional<VerifiedToken> verify(String token) {
        if (token == null || token.isBlank()) {
            return java.util.Optional.empty();
        }
        String raw = token.startsWith("Bearer ") ? token.substring("Bearer ".length()).trim() : token.trim();
        int separator = raw.lastIndexOf('.');
        if (separator <= 0 || separator == raw.length() - 1) {
            return java.util.Optional.empty();
        }
        String payload;
        byte[] signature;
        try {
            Base64.Decoder decoder = Base64.getUrlDecoder();
            payload = new String(decoder.decode(raw.substring(0, separator)), StandardCharsets.UTF_8);
            signature = decoder.decode(raw.substring(separator + 1));
        } catch (IllegalArgumentException ex) {
            return java.util.Optional.empty();
        }
        if (!MessageDigest.isEqual(sign(payload), signature)) {
            return java.util.Optional.empty();
        }
        String[] parts = payload.split("\\|");
        if (parts.length != 3 || parts[0].isBlank() || parts[1].isBlank()) {
            return java.util.Optional.empty();
        }
        Instant expiresAt;
        try {
            expiresAt = Instant.ofEpochSecond(Long.parseLong(parts[2]));
        } catch (NumberFormatException ex) {
            return java.util.Optional.empty();
        }
        if (!expiresAt.isAfter(Instant.now())) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(new VerifiedToken(parts[0], parts[1], expiresAt));
    }

    private byte[] sign(String payload) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret, ALGORITHM));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("Token signing is unavailable", ex);
        }
    }
}
