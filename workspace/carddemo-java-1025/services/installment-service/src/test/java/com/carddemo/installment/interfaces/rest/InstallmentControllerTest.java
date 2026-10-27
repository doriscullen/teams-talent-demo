package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.application.InstallmentApplicationService;
import com.carddemo.installment.application.InstallmentQueryService;
import com.carddemo.installment.application.PreviewService;
import com.carddemo.installment.application.SettlementService;
import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.ForbiddenException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.model.SourceType;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 接口层契约（AC-14/AC-16）：401 无主体、403 只读身份写、201 创建、409 结清冲突、400 参数。 */
class InstallmentControllerTest {

    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");

    private PreviewService previewService;
    private InstallmentApplicationService applicationService;
    private InstallmentQueryService queryService;
    private SettlementService settlementService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        previewService = mock(PreviewService.class);
        applicationService = mock(InstallmentApplicationService.class);
        queryService = mock(InstallmentQueryService.class);
        settlementService = mock(SettlementService.class);
        mvc = MockMvcBuilders.standaloneSetup(
                        new InstallmentController(previewService, applicationService, queryService, settlementService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private InstallmentPlan plan() {
        InstallmentPlan plan = mock(InstallmentPlan.class);
        when(plan.getPlanId()).thenReturn("IP0001");
        when(plan.getStatus()).thenReturn(PlanStatus.ACTIVE);
        when(plan.getPrincipal()).thenReturn(new BigDecimal("1000.00"));
        when(plan.getTermMonths()).thenReturn(6);
        when(plan.getTotalFee()).thenReturn(new BigDecimal("19.25"));
        return plan;
    }

    @Test
    void missingPrincipalIsUnauthorized() throws Exception {
        mvc.perform(get("/api/v1/installments").param("accountId", "00000000006"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void createReturns201ForNewPlan() throws Exception {
        InstallmentPlan created = plan();
        when(applicationService.create(any(), any()))
                .thenReturn(new InstallmentApplicationService.CreateResult(created, false));

        mvc.perform(post("/api/v1/installments")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"idempotencyKey":"key-1","accountId":"00000000006","sourceType":"TRANSACTION",
                                 "sourceId":"0000000000000200","principal":1000.00,"termMonths":6,
                                 "previewToken":"token","agreementAccepted":true}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.planId").value("IP0001"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    void createReplayReturns200() throws Exception {
        InstallmentPlan replayed = plan();
        when(applicationService.create(any(), any()))
                .thenReturn(new InstallmentApplicationService.CreateResult(replayed, true));

        mvc.perform(post("/api/v1/installments")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"idempotencyKey":"key-1","accountId":"00000000006","sourceType":"TRANSACTION",
                                 "sourceId":"0000000000000200","principal":1000.00,"termMonths":6,
                                 "previewToken":"token","agreementAccepted":true}
                                """))
                .andExpect(status().isOk());
    }

    @Test
    void riskReadOnlyIdentityCannotWrite() throws Exception {
        when(applicationService.create(any(), any()))
                .thenThrow(new ForbiddenException("Back-office user has no write permission for installments."));

        mvc.perform(post("/api/v1/installments")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, new InstallmentPrincipal("ADMIN003", "A"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"idempotencyKey":"key-2","accountId":"00000000006","sourceType":"TRANSACTION",
                                 "sourceId":"0000000000000200","principal":1000.00,"termMonths":6,
                                 "previewToken":"token","agreementAccepted":true}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void settlementConflictMapsTo409() throws Exception {
        when(settlementService.settle(any(), any()))
                .thenThrow(new BusinessRuleException("SETTLEMENT_NOT_ALLOWED", "Only ACTIVE plans can be settled."));

        mvc.perform(post("/api/v1/installments/IP0001/early-settlement")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settlementIdempotencyKey\":\"settle-2\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SETTLEMENT_NOT_ALLOWED"));
    }

    @Test
    void invalidTermMapsTo400() throws Exception {
        when(applicationService.create(any(), any()))
                .thenThrow(new BusinessRuleException("INVALID_TERM", "Only 3, 6 or 12 periods are supported."));

        mvc.perform(post("/api/v1/installments")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"idempotencyKey":"key-3","accountId":"00000000006","sourceType":"TRANSACTION",
                                 "sourceId":"0000000000000200","principal":1000.00,"termMonths":9,
                                 "previewToken":"token","agreementAccepted":true}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void previewReturnsComputedSchedule() throws Exception {
        when(previewService.preview(any())).thenReturn(new PreviewService.PreviewResult("token", "TRANSACTION",
                "0000000000000200", new BigDecimal("1000.00"), 6, new BigDecimal("0.0055"),
                new BigDecimal("19.25"), new BigDecimal("172.16"),
                List.of(new com.carddemo.installment.domain.service.FeeScheduleCalculator.Period(1,
                        new BigDecimal("166.66"), new BigDecimal("5.50"))), null, null, new BigDecimal("1000.00")));

        mvc.perform(post("/api/v1/installments/preview")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"accountId":"00000000006","sourceType":"TRANSACTION",
                                 "sourceId":"0000000000000200","principal":1000.00,"termMonths":6}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalFee").value(19.25))
                .andExpect(jsonPath("$.periods[0].principal").value(166.66));
    }

    @Test
    void listRejectsInvalidPageSize() throws Exception {
        when(queryService.list(any(), eq("00000000006"), any(), eq(1), eq(200)))
                .thenThrow(new BusinessRuleException("INVALID_PARAMETER", "page must be >= 1 and size between 1 and 100."));

        mvc.perform(get("/api/v1/installments")
                        .param("accountId", "00000000006").param("size", "200")
                        .requestAttr(InstallmentPrincipal.ATTRIBUTE, CUSTOMER))
                .andExpect(status().isBadRequest());
    }
}
