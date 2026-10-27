package com.carddemo.installment;

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

    @Test
    void migrationsApplyOnRealPostgres() {
        List<String> versions = jdbc.queryForList(
                "select version from flyway_schema_history where success order by installed_rank", String.class);

        assertThat(versions).contains("1", "2", "3", "4");
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

    private int integerColumnCount(String table, String column) {
        Integer count = jdbc.queryForObject("select count(*) from information_schema.columns "
                + "where table_name = ? and column_name = ? and data_type = 'integer'", Integer.class, table, column);
        return count == null ? 0 : count;
    }
}
