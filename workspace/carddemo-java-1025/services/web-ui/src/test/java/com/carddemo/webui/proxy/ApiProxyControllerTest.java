package com.carddemo.webui.proxy;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

class ApiProxyControllerTest {

    private final ApiProxyController controller = new ApiProxyController(
            "http://iam:8081", "http://customer:8082", "http://card:8083",
            "http://account:8084", "http://transaction:8085", "http://authorization:8086",
            "http://marketing:8087", "http://installment:8088");

    @Test
    void routesByContextPrefix() {
        assertThat(controller.resolveTarget("/api/v1/auth/login")).isEqualTo("http://iam:8081");
        assertThat(controller.resolveTarget("/api/v1/users/ADMIN001")).isEqualTo("http://iam:8081");
        assertThat(controller.resolveTarget("/api/v1/customers/000000001")).isEqualTo("http://customer:8082");
        assertThat(controller.resolveTarget("/api/v1/cards/by-account/00000000001")).isEqualTo("http://card:8083");
        assertThat(controller.resolveTarget("/api/v1/accounts/00000000001")).isEqualTo("http://account:8084");
        assertThat(controller.resolveTarget("/api/v1/transactions/0000000000000001"))
                .isEqualTo("http://transaction:8085");
        assertThat(controller.resolveTarget("/api/v1/transaction-types"))
                .isEqualTo("http://transaction:8085");
        assertThat(controller.resolveTarget("/api/v1/reports/transactions"))
                .isEqualTo("http://transaction:8085");
        assertThat(controller.resolveTarget("/api/v1/bill-payments")).isEqualTo("http://transaction:8085");
        assertThat(controller.resolveTarget("/api/v1/pending-authorizations/00000000001"))
                .isEqualTo("http://authorization:8086");
        assertThat(controller.resolveTarget("/api/v1/authorization-purges"))
                .isEqualTo("http://authorization:8086");
        assertThat(controller.resolveTarget("/api/v1/campaigns/c1")).isEqualTo("http://marketing:8087");
        assertThat(controller.resolveTarget("/api/v1/eligibilities")).isEqualTo("http://marketing:8087");
        assertThat(controller.resolveTarget("/api/v1/reward-evaluations")).isEqualTo("http://marketing:8087");
        assertThat(controller.resolveTarget("/api/v1/rewards/r1/fulfill")).isEqualTo("http://marketing:8087");
        assertThat(controller.resolveTarget("/api/v1/marketing/summary")).isEqualTo("http://marketing:8087");
        assertThat(controller.resolveTarget("/api/v1/installments/preview")).isEqualTo("http://installment:8088");
        assertThat(controller.resolveTarget("/api/v1/installments/IP1/early-settlement"))
                .isEqualTo("http://installment:8088");
        assertThat(controller.resolveTarget("/api/v1/admin/installments/exports"))
                .isEqualTo("http://installment:8088");
    }

    @Test
    void doesNotMatchLookalikePaths() {
        assertThat(controller.resolveTarget("/api/v1/accountszzz")).isNull();
        assertThat(controller.resolveTarget("/api/v1/user")).isNull();
        assertThat(controller.resolveTarget("/api/v2/accounts")).isNull();
    }
}
