package com.carddemo.installment.infrastructure.security;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.model.SourceType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.Base64;

/**
 * 试算令牌（BR-INS-14）：自签名令牌，不落库（原文 §4.2「试算不落库」）。
 * 绑定账户/来源/本金/期数/费率/签发时间；篡改、过期或与提交参数不一致统一 PREVIEW_EXPIRED。
 */
@Component
public class PreviewTokenService {

    private static final String ALGORITHM = "HmacSHA256";
    private static final String SEPARATOR = "|";

    private final byte[] secret;
    private final int ttlMinutes;

    public PreviewTokenService(@Value("${installment.preview.secret}") String secret,
                               @Value("${installment.preview.ttl-minutes:30}") int ttlMinutes) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.ttlMinutes = ttlMinutes;
    }

    public record PreviewPayload(String accountId, SourceType sourceType, String sourceId,
                                 BigDecimal principal, int termMonths, BigDecimal monthlyFeeRate,
                                 LocalDateTime issuedAt) {
    }

    public String issue(PreviewPayload payload) {
        String body = String.join(SEPARATOR,
                payload.accountId(),
                payload.sourceType().name(),
                payload.sourceId(),
                payload.principal().setScale(2).toPlainString(),
                Integer.toString(payload.termMonths()),
                payload.monthlyFeeRate().setScale(4).toPlainString(),
                Long.toString(payload.issuedAt().atZone(ClockProvider.ZONE).toEpochSecond()));
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return encoder.encodeToString(body.getBytes(StandardCharsets.UTF_8))
                + "." + encoder.encodeToString(sign(body));
    }

    public PreviewPayload verify(String token, LocalDateTime now) {
        if (token == null || token.isBlank()) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token is required.");
        }
        int separator = token.lastIndexOf('.');
        if (separator <= 0 || separator == token.length() - 1) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token is malformed.");
        }
        String body;
        byte[] signature;
        try {
            Base64.Decoder decoder = Base64.getUrlDecoder();
            body = new String(decoder.decode(token.substring(0, separator)), StandardCharsets.UTF_8);
            signature = decoder.decode(token.substring(separator + 1));
        } catch (IllegalArgumentException ex) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token is malformed.");
        }
        if (!MessageDigest.isEqual(sign(body), signature)) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token signature is invalid.");
        }
        String[] parts = body.split("\\" + SEPARATOR);
        if (parts.length != 7) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token is malformed.");
        }
        try {
            LocalDateTime issuedAt = LocalDateTime.ofEpochSecond(Long.parseLong(parts[6]), 0, ClockProvider.ZONE.getRules().getOffset(now));
            if (issuedAt.plusMinutes(ttlMinutes).isBefore(now) || issuedAt.plusMinutes(ttlMinutes).isEqual(now)) {
                throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token has expired.");
            }
            return new PreviewPayload(parts[0], SourceType.valueOf(parts[1]), parts[2],
                    new BigDecimal(parts[3]), Integer.parseInt(parts[4]), new BigDecimal(parts[5]), issuedAt);
        } catch (NumberFormatException | java.time.DateTimeException ex) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token is malformed.");
        }
    }

    public void requireMatches(PreviewPayload payload, String accountId, SourceType sourceType,
                               String sourceId, BigDecimal principal, int termMonths) {
        boolean matches = payload.accountId().equals(accountId)
                && payload.sourceType() == sourceType
                && payload.sourceId().equals(sourceId)
                && payload.principal().compareTo(principal) == 0
                && payload.termMonths() == termMonths;
        if (!matches) {
            throw new BusinessRuleException("PREVIEW_EXPIRED", "Preview token does not match this request.");
        }
    }

    private byte[] sign(String body) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret, ALGORITHM));
            return mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("Preview signing is unavailable", ex);
        }
    }
}
