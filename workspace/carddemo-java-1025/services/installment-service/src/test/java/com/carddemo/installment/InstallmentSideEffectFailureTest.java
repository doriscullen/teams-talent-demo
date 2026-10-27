package com.carddemo.installment;

import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.infrastructure.support.AuditRetryWorker;
import com.carddemo.installment.infrastructure.support.LocalNotificationSender;
import com.carddemo.installment.infrastructure.support.NotificationWorker;
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

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 真实 PostgreSQL 表级故障注入（R-C-01）：
 * 用触发器拒绝 installment_audit_event / installment_notification_outbox 的 INSERT，
 * 证明审计/通知这类「非关键副作用」不会污染业务事务（计划行仍提交），
 * 失败记录写进真实可重试队列；恢复（删除触发器）后恰好重放/投递一次。
 */
@SpringBootTest
@Testcontainers
class InstallmentSideEffectFailureTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private static final Path DELIVERY_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "carddemo-side-effect-" + System.nanoTime());

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
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
    private AuditRetryWorker auditRetryWorker;
    @Autowired
    private NotificationWorker notificationWorker;
    @Autowired
    private LocalNotificationSender notificationSender;
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
    void auditInsertFailureDoesNotRollBackBusinessTransactionAndIsReplayedAfterRestore() {
        jdbc.execute("create or replace function deny_audit_insert() returns trigger as $$ "
                + "begin raise exception 'audit insert denied by test trigger'; end; $$ language plpgsql");
        jdbc.execute("create trigger deny_audit before insert on installment_audit_event "
                + "for each row execute function deny_audit_insert()");

        try {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            transaction.executeWithoutResult(status -> {
                insertPlan("IP-AUDIT-FAIL");
                auditPort.record("ADMIN002", "TEST_AUDIT_DENIED", "INSTALLMENT_PLAN", "IP-AUDIT-FAIL", "payload");
            });
        } finally {
            jdbc.execute("drop trigger deny_audit on installment_audit_event");
            jdbc.execute("drop function deny_audit_insert()");
        }

        // 业务事务正常提交：被声明为非关键的审计失败没有回滚计划
        assertThat(count("select count(*) from installment_plan where plan_id = 'IP-AUDIT-FAIL'")).isEqualTo(1);
        assertThat(count("select count(*) from installment_audit_event where action = 'TEST_AUDIT_DENIED'"))
                .isZero();
        assertThat(count("select count(*) from installment_audit_retry where action = 'TEST_AUDIT_DENIED'"))
                .isEqualTo(1);

        int replayed = auditRetryWorker.replayQueue();

        assertThat(replayed).isEqualTo(1);
        assertThat(count("select count(*) from installment_audit_event where action = 'TEST_AUDIT_DENIED'"))
                .isEqualTo(1);
        assertThat(count("select count(*) from installment_audit_retry where action = 'TEST_AUDIT_DENIED'"))
                .isZero();
    }

    @Test
    void notificationInsertFailureDoesNotRollBackBusinessAndDeliversExactlyOnceAfterRestore() throws Exception {
        jdbc.execute("create or replace function deny_outbox_insert() returns trigger as $$ "
                + "begin raise exception 'outbox insert denied by test trigger'; end; $$ language plpgsql");
        jdbc.execute("create trigger deny_outbox before insert on installment_notification_outbox "
                + "for each row execute function deny_outbox_insert()");

        try {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            transaction.executeWithoutResult(status -> {
                insertPlan("IP-NOTIFY-FAIL");
                notificationPort.enqueue("SMS", "00000000006", "TEST_NOTIFY_DENIED", "planId=IP-NOTIFY-FAIL");
            });
        } finally {
            jdbc.execute("drop trigger deny_outbox on installment_notification_outbox");
            jdbc.execute("drop function deny_outbox_insert()");
        }

        assertThat(count("select count(*) from installment_plan where plan_id = 'IP-NOTIFY-FAIL'")).isEqualTo(1);
        assertThat(count("select count(*) from installment_notification_outbox where template = 'TEST_NOTIFY_DENIED'"))
                .isZero();
        assertThat(count("select count(*) from installment_notification_retry where template = 'TEST_NOTIFY_DENIED'"))
                .isEqualTo(1);

        assertThat(notificationWorker.dispatchDue()).isEqualTo(1);
        assertThat(count("select count(*) from installment_notification_outbox where template = 'TEST_NOTIFY_DENIED'"))
                .isEqualTo(1);
        assertThat(count("select count(*) from installment_notification_retry where template = 'TEST_NOTIFY_DENIED'"))
                .isZero();
        assertThat(count("select count(*) from installment_notification_outbox "
                + "where template = 'TEST_NOTIFY_DENIED' and status = 'SENT'")).isEqualTo(1);
        long files;
        try (var stream = Files.list(DELIVERY_DIR)) {
            files = stream.filter(path -> path.getFileName().toString().endsWith(".json")).count();
        }
        assertThat(files).isEqualTo(1);

        // 再跑一轮不会重复投递，也不会产生第二个文件
        assertThat(notificationWorker.dispatchDue()).isZero();
        try (var stream = Files.list(DELIVERY_DIR)) {
            assertThat(stream.filter(path -> path.getFileName().toString().endsWith(".json")).count()).isEqualTo(1);
        }
        assertThat(notificationSender.deliveredFileCount()).isEqualTo(1);
    }

    @Test
    void exhaustedNotificationCanBeRequeuedByAuthorizedRecoveryPath() throws Exception {
        notificationPort.enqueue("SMS", "00000000006", "TEST_NOTIFY_EXHAUSTED", "planId=IP-EXHAUSTED");
        notificationWorker.dispatchDue();
        Long id = jdbc.queryForObject("select notification_id from installment_notification_outbox "
                + "where template = 'TEST_NOTIFY_EXHAUSTED'", Long.class);
        assertThat(id).isNotNull();
        // 模拟自动重试耗尽
        jdbc.update("update installment_notification_outbox set status = 'FAILED', attempts = 5, "
                + "last_error = 'sink offline' where notification_id = ?", id);
        assertThat(notificationWorker.dispatchDue()).isZero();

        assertThat(notificationWorker.requeueAndDispatch(id)).isTrue();
        assertThat(jdbc.queryForObject("select status from installment_notification_outbox where notification_id = ?",
                String.class, id)).isEqualTo("SENT");
        assertThat(notificationWorker.requeueAndDispatch(id)).isFalse();
    }

    @Test
    void businessRowAndSideEffectsRemainConsistentWhenStoreAcceptsEverything() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.executeWithoutResult(status -> {
            insertPlan("IP-HEALTHY");
            auditPort.record("USER0001", "TEST_AUDIT_OK", "INSTALLMENT_PLAN", "IP-HEALTHY", "payload");
            notificationPort.enqueue("SMS", "00000000006", "TEST_NOTIFY_OK", "planId=IP-HEALTHY");
        });

        assertThat(count("select count(*) from installment_plan where plan_id = 'IP-HEALTHY'")).isEqualTo(1);
        assertThat(count("select count(*) from installment_audit_event where action = 'TEST_AUDIT_OK'"))
                .isEqualTo(1);
        assertThat(count("select count(*) from installment_notification_outbox where template = 'TEST_NOTIFY_OK'"))
                .isEqualTo(1);
        assertThat(new BigDecimal("19.25")).isNotNull();
    }
}
