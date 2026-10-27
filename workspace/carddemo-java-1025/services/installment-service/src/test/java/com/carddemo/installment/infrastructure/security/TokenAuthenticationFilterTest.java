package com.carddemo.installment.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** AC-14：无 token / 非法 token → 401；有效 token → 主体写入请求属性。 */
class TokenAuthenticationFilterTest {

    private final HmacTokenVerifier verifier = mock(HmacTokenVerifier.class);
    private final TokenAuthenticationFilter filter = new TokenAuthenticationFilter(verifier);

    @Test
    void missingTokenReturns401WithoutCallingChain() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/installments");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        when(verifier.verify(null)).thenReturn(java.util.Optional.empty());

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("UNAUTHENTICATED");
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void validTokenPropagatesPrincipal() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/installments");
        request.addHeader("Authorization", "Bearer token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        when(verifier.verify("Bearer token")).thenReturn(java.util.Optional.of(
                new HmacTokenVerifier.VerifiedToken("USER0001", "U", java.time.Instant.now().plusSeconds(60))));

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(request.getAttribute(InstallmentPrincipal.ATTRIBUTE))
                .isEqualTo(new InstallmentPrincipal("USER0001", "U"));
    }

    @Test
    void otherPathsAreNotFiltered() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/accounts/00000000006");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        assertThat(filter.shouldNotFilter(request)).isTrue();
        filter.doFilter(request, response, chain);
        verify(verifier, never()).verify(any());
    }
}
