package com.carddemo.installment;

import com.carddemo.installment.domain.repository.AccountLimitViewRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 真实 PostgreSQL 启动/迁移/Schema 校验（本轮 verify 阻塞的回归防线）：
 * Spring 上下文以 {@code ddl-auto=validate} 启动，Flyway 在真实 PG 上执行 V1..V3；
 * 任一实体与列类型漂移都会让本测试失败，而不是等到部署阶段才发现。
 */
@SpringBootTest
@Testcontainers
class InstallmentSchemaValidationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("installment.workers.enabled", () -> false);
        registry.add("installment.notification.delivery-dir",
                () -> System.getProperty("java.io.tmpdir") + "/carddemo-installment-notifications-test");
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private AccountLimitViewRepository accountLimitView;

    @Test
    void migrationsApplyOnRealPostgres() {
        List<String> versions = jdbc.queryForList(
                "select version from flyway_schema_history where success order by installed_rank", String.class);

        assertThat(versions).contains("1", "2", "3", "4", "5", "6", "7");
    }

    @Test
    void numericColumnsMatchJpaEntities() {
        // 历史缺陷：V1 建表用 SMALLINT，实体为 int，Hibernate validate 让服务无法启动
        assertThat(integerColumnCount("installment_plan", "term_months")).isEqualTo(1);
        assertThat(integerColumnCount("installment_schedule", "installment_no")).isEqualTo(1);
        assertThat(integerColumnCount("installment_rate", "term_months")).isEqualTo(1);
        // 与实体 Short 保持一致的列不能被顺手改成 INT
        assertThat(jdbc.queryForObject("select data_type from information_schema.columns "
                + "where table_name = 'installment_policy' and column_name = 'id'", String.class))
                .isEqualTo("smallint");
    }

    @Test
    void seedPolicyAndSettlementFenceExist() {
        assertThat(jdbc.queryForObject(
                "select max_active_plans_per_account from installment_policy where id = 1", Integer.class))
                .isEqualTo(20);
        assertThat(jdbc.queryForObject("select count(*) from pg_indexes "
                + "where indexname = 'uk_installment_settlement_active_plan'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from information_schema.tables "
                + "where table_name in ('installment_application_intent', 'installment_repayment')", Integer.class))
                .isEqualTo(2);
    }

    @Test
    void accountLimitViewSumsOnlyActiveRemainingPrincipal() {
        insertPlan("IPVIEW0001", "00000000090", "ACTIVE", "1000.00", "view-key-1");
        insertPlan("IPVIEW0002", "00000000090", "ACTIVE", "600.00", "view-key-2");
        insertPlan("IPVIEW0003", "00000000090", "SETTLED", "600.00", "view-key-3");
        insertPlan("IPVIEW0004", "00000000090", "CANCELLED", "500.00", "view-key-4");

        AccountLimitViewRepository.Occupancy occupancy = accountLimitView.findOccupancy("00000000090");

        assertThat(occupancy.installmentOccupied()).isEqualByComparingTo("1600.00");
        assertThat(occupancy.activePlanCount()).isEqualTo(2);
    }

    @Test
    void accountLimitViewFollowsRepaymentAndSettlement() {
        insertPlan("IPVIEW0011", "00000000091", "ACTIVE", "1000.00", "view-key-11");

        jdbc.update("update installment_plan set remaining_principal = 700.00 where plan_id = 'IPVIEW0011'");
        assertThat(accountLimitView.findOccupancy("00000000091").installmentOccupied())
                .isEqualByComparingTo("700.00");

        jdbc.update("update installment_plan set remaining_principal = 0.00, status = 'SETTLED' "
                + "where plan_id = 'IPVIEW0011'");
        AccountLimitViewRepository.Occupancy settled = accountLimitView.findOccupancy("00000000091");
        assertThat(settled.installmentOccupied()).isEqualByComparingTo("0.00");
        assertThat(settled.activePlanCount()).isZero();
    }

    @Test
    void accountLimitViewIsZeroForAccountWithoutPlans() {
        AccountLimitViewRepository.Occupancy occupancy = accountLimitView.findOccupancy("00000000099");

        assertThat(occupancy.installmentOccupied()).isEqualByComparingTo("0.00");
        assertThat(occupancy.activePlanCount()).isZero();
    }

    private void insertPlan(String planId, String accountId, String status, String remainingPrincipal,
                            String idempotencyKey) {
        jdbc.update("insert into installment_plan (plan_id, account_id, source_type, source_id, principal, "
                        + "term_months, monthly_fee_rate, total_fee, remaining_principal, status, created_at, "
                        + "idempotency_key) values (?, ?, 'TRANSACTION', ?, 1000.00, 6, 0.0055, 19.25, ?, ?, "
                        + "CURRENT_TIMESTAMP, ?)",
                planId, accountId, "0000000000" + planId.substring(planId.length() - 2),
                new java.math.BigDecimal(remainingPrincipal), status, idempotencyKey);
    }

    private int integerColumnCount(String table, String column) {
        Integer count = jdbc.queryForObject("select count(*) from information_schema.columns "
                + "where table_name = ? and column_name = ? and data_type = 'integer'", Integer.class, table, column);
        return count == null ? 0 : count;
    }
}
