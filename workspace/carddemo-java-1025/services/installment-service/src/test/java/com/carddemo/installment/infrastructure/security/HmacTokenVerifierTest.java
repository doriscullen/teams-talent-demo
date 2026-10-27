package com.carddemo.installment.infrastructure.security;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/** BR-INS-13 / AC-14：真实 IAM HMAC token 形状（base64url(payload).base64url(HmacSHA256)）。 */
class HmacTokenVerifierTest {

    private static final String SECRET = "test-secret";
    private final HmacTokenVerifier verifier = new HmacTokenVerifier(SECRET);

    static String token(String userId, String userType, Instant expiresAt, String secret) {
        String payload = userId + "|" + userType + "|" + expiresAt.getEpochSecond();
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] signature = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            return encoder.encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "."
                    + encoder.encodeToString(signature);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    @Test
    void acceptsValidTokenWithBearerPrefix() {
        String token = token("USER0001", "U", Instant.now().plusSeconds(600), SECRET);
        assertThat(verifier.verify(token)).isPresent();
        assertThat(verifier.verify("Bearer " + token)).get()
                .extracting(HmacTokenVerifier.VerifiedToken::userId).isEqualTo("USER0001");
        assertThat(verifier.verify("Bearer " + token)).get()
                .extracting(HmacTokenVerifier.VerifiedToken::userType).isEqualTo("U");
    }

    @Test
    void rejectsExpiredToken() {
        String token = token("USER0001", "U", Instant.now().minusSeconds(5), SECRET);
        assertThat(verifier.verify(token)).isEmpty();
    }

    @Test
    void rejectsTokenSignedWithDifferentSecret() {
        String token = token("USER0001", "U", Instant.now().plusSeconds(600), "other-secret");
        assertThat(verifier.verify(token)).isEmpty();
    }

    @Test
    void rejectsBlankOrMalformedTokens() {
        assertThat(verifier.verify(null)).isEmpty();
        assertThat(verifier.verify("")).isEmpty();
        assertThat(verifier.verify("abc")).isEmpty();
        assertThat(verifier.verify("a.b.c")).isEmpty();
    }
}
