package com.carddemo.installment.infrastructure.security;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.model.SourceType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** BR-INS-14 / INS-03：试算令牌自签名、不落库、30 分钟过期、参数绑定。 */
class PreviewTokenServiceTest {

    private final PreviewTokenService service = new PreviewTokenService("preview-secret", 30);
    private final LocalDateTime now = LocalDateTime.of(2026, 10, 27, 10, 0);

    private PreviewTokenService.PreviewPayload payload() {
        return new PreviewTokenService.PreviewPayload("00000000006", SourceType.TRANSACTION,
                "0000000000000200", new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"), now);
    }

    @Test
    void issueAndVerifyRoundTrip() {
        String token = service.issue(payload());
        PreviewTokenService.PreviewPayload verified = service.verify(token, now.plusMinutes(29));
        assertThat(verified.accountId()).isEqualTo("00000000006");
        assertThat(verified.principal()).isEqualByComparingTo("1000.00");
        assertThat(verified.termMonths()).isEqualTo(6);
        assertThat(verified.monthlyFeeRate()).isEqualByComparingTo("0.0055");
    }

    @Test
    void tokenExpiresAfterTtl() {
        String token = service.issue(payload());
        assertThatThrownBy(() -> service.verify(token, now.plusMinutes(31)))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PREVIEW_EXPIRED");
    }

    @Test
    void tamperedTokenIsRejected() {
        String token = service.issue(payload());
        String tampered = token.substring(0, token.length() - 2) + "AA";
        assertThatThrownBy(() -> service.verify(tampered, now))
                .isInstanceOf(BusinessRuleException.class);
    }

    @Test
    void blankOrMalformedTokenIsRejected() {
        assertThatThrownBy(() -> service.verify(null, now)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> service.verify("not-a-token", now)).isInstanceOf(BusinessRuleException.class);
    }

    @Test
    void tokenMustMatchSubmittedRequest() {
        PreviewTokenService.PreviewPayload verified =
                service.verify(service.issue(payload()), now.plusMinutes(1));
        assertThatThrownBy(() -> service.requireMatches(verified, "00000000006", SourceType.TRANSACTION,
                "0000000000000200", new BigDecimal("1000.01"), 6))
                .isInstanceOf(BusinessRuleException.class)
                .extracting(ex -> ((BusinessRuleException) ex).getCode())
                .isEqualTo("PREVIEW_EXPIRED");
        assertThatThrownBy(() -> service.requireMatches(verified, "00000000006", SourceType.BILL,
                "0000000000000200", new BigDecimal("1000.00"), 6))
                .isInstanceOf(BusinessRuleException.class);
    }
}
