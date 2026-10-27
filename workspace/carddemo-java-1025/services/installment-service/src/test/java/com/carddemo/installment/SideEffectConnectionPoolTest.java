package com.carddemo.installment;

import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.infrastructure.support.SideEffectTransactions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A-PERF-001 回归：副作用不得在业务事务的提交回调里借连接。
 *
 * <p>把连接池刻意压到 2、连接获取超时压到 3 秒（只为放大缺陷，不放宽产品默认配置），
 * 让 8 个并发请求各自“业务事务 + 审计 + 通知”后按请求边界统一落库：
 * 旧实现（afterCommit 内嵌套 REQUIRES_NEW）在池被占满时取不到连接，会出现 3 秒超时失败；
 * 现实现每条副作用单层事务、只在业务连接归还后执行，全部应成功。
 * 另外验证业务事务回滚时登记的副作用被丢弃（不写审计/通知）。</p>
 */
@SpringBootTest
@Testcontainers
class SideEffectConnectionPoolTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private static final Path DELIVERY_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "carddemo-pool-" + System.nanoTime());

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "2");
        registry.add("spring.datasource.hikari.connection-timeout", () -> "3000");
        registry.add("installment.workers.enabled", () -> false);
        registry.add("installment.notification.delivery-dir", DELIVERY_DIR::toString);
    }

    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private AuditPort auditPort;
    @Autowired
    private NotificationPort notificationPort;
    @Autowired
    private SideEffectTransactions sideEffects;
    @Autowired
    private PlatformTransactionManager transactionManager;

    private void insertPlan(String planId) {
        jdbc.update("insert into installment_plan (plan_id, account_id, customer_id, source_type, source_id, "
                        + "principal, term_months, monthly_fee_rate, total_fee, remaining_principal, status, "
                        + "created_at, idempotency_key, version) "
                        + "values (?, '00000000006', null, 'TRANSACTION', '0000000000000200', 1000.00, 6, 0.0055, "
                        + "19.25, 1000.00, 'ACTIVE', ?, ?, 0)",
                planId, LocalDateTime.now(), "key-" + planId);
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    @Test
    void concurrentSideEffectsDoNotExhaustSmallPool() throws Exception {
        int workers = 8;
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(workers);
        List<String> failures = Collections.synchronizedList(new ArrayList<>());
        List<Thread> threads = new ArrayList<>();
        for (int index = 0; index < workers; index++) {
            final int i = index;
            Thread thread = new Thread(() -> {
                try {
                    start.await();
                    transaction.executeWithoutResult(status -> {
                        insertPlan("IP-POOL-" + i);
                        auditPort.record("USER0001", "TEST_POOL_AUDIT", "INSTALLMENT_PLAN", "IP-POOL-" + i,
                                "index=" + i);
                        notificationPort.enqueue("SMS", "00000000006", "TEST_POOL_NOTIFY", "planId=IP-POOL-" + i);
                    });
                    // 请求边界（SideEffectFlushFilter）等价动作：业务事务已结束、连接已归还
                    sideEffects.flush();
                } catch (RuntimeException | InterruptedException ex) {
                    failures.add(ex.getClass().getSimpleName() + ": " + ex.getMessage());
                } finally {
                    done.countDown();
                }
            });
            threads.add(thread);
            thread.start();
        }
        start.countDown();
        assertThat(done.await(30, TimeUnit.SECONDS)).as("side effects must not starve the pool").isTrue();
        threads.forEach(thread -> {
            try {
                thread.join(1000);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        });

        assertThat(failures).as("side effect failures").isEmpty();
        assertThat(count("select count(*) from installment_plan where plan_id like 'IP-POOL-%'")).isEqualTo(workers);
        assertThat(count("select count(*) from installment_audit_event where action = 'TEST_POOL_AUDIT'"))
                .isEqualTo(workers);
        assertThat(count("select count(*) from installment_notification_outbox where template = 'TEST_POOL_NOTIFY'"))
                .isEqualTo(workers);
        assertThat(count("select count(*) from installment_audit_retry")).isZero();
        assertThat(count("select count(*) from installment_notification_retry")).isZero();
    }

    @Test
    void rolledBackBusinessTransactionDoesNotProduceSideEffects() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.executeWithoutResult(status -> {
            insertPlan("IP-POOL-ROLLBACK");
            auditPort.record("USER0001", "TEST_POOL_ROLLBACK", "INSTALLMENT_PLAN", "IP-POOL-ROLLBACK", "payload");
            notificationPort.enqueue("SMS", "00000000006", "TEST_POOL_ROLLBACK", "planId=IP-POOL-ROLLBACK");
            status.setRollbackOnly();
        });

        assertThat(sideEffects.flush()).isZero();
        assertThat(count("select count(*) from installment_plan where plan_id = 'IP-POOL-ROLLBACK'")).isZero();
        assertThat(count("select count(*) from installment_audit_event where action = 'TEST_POOL_ROLLBACK'"))
                .isZero();
        assertThat(count("select count(*) from installment_notification_outbox where template = 'TEST_POOL_ROLLBACK'"))
                .isZero();
    }
}
