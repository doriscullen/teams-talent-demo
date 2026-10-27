package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.model.NotificationRetry;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import com.carddemo.installment.domain.repository.NotificationRetryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 通知投递（C-03）：真实投递落盘、目标不可用可见失败、恢复后补发、达到上限不再重试。
 */
class NotificationWorkerTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);

    @TempDir
    Path deliveryDir;

    private NotificationOutboxRepository repository;
    private NotificationRetryRepository retryRepository;
    private LocalNotificationSender sender;
    private NotificationWorker worker;
    private final Map<Long, NotificationOutbox> rows = new HashMap<>();
    private final Map<Long, NotificationRetry> retries = new HashMap<>();

    @BeforeEach
    void setUp() {
        repository = mock(NotificationOutboxRepository.class);
        retryRepository = mock(NotificationRetryRepository.class);
        sender = new LocalNotificationSender(deliveryDir.toString());
        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);

        when(repository.saveAndFlush(any(NotificationOutbox.class))).thenAnswer(invocation -> {
            NotificationOutbox row = invocation.getArgument(0);
            rows.put(row.getNotificationId(), row);
            return row;
        });
        when(repository.claim(anyLong())).thenReturn(1);
        when(repository.findById(anyLong())).thenAnswer(invocation ->
                Optional.ofNullable(rows.get(invocation.getArgument(0))));
        when(repository.findByStatusInOrderByNotificationIdAsc(any())).thenAnswer(invocation ->
                List.copyOf(rows.values()));
        when(retryRepository.findAllByOrderByRetryIdAsc()).thenAnswer(invocation ->
                List.copyOf(retries.values()));
        when(retryRepository.findById(anyLong())).thenAnswer(invocation ->
                Optional.ofNullable(retries.get(invocation.getArgument(0))));
        when(retryRepository.saveAndFlush(any(NotificationRetry.class))).thenAnswer(invocation -> {
            NotificationRetry row = invocation.getArgument(0);
            retries.put(row.getRetryId(), row);
            return row;
        });
        org.mockito.Mockito.doAnswer(invocation -> {
            NotificationRetry row = invocation.getArgument(0);
            retries.remove(row.getRetryId());
            return null;
        }).when(retryRepository).delete(org.mockito.ArgumentMatchers.<NotificationRetry>any());

        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        worker = new NotificationWorker(repository, retryRepository, sender, clock, txManager, true);
    }

    private NotificationOutbox pending(long id) {
        NotificationOutbox row = new NotificationOutbox("SMS", "00000000006", "INSTALLMENT_CREATED",
                "planId=IP1", NOW);
        setField(row, id);
        rows.put(id, row);
        return row;
    }

    private static void setField(NotificationOutbox row, long id) {
        try {
            var field = NotificationOutbox.class.getDeclaredField("notificationId");
            field.setAccessible(true);
            field.set(row, id);
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException(ex);
        }
    }

    @Test
    void pendingNotificationIsDeliveredAndMarkedSent() {
        NotificationOutbox row = pending(1L);

        int sent = worker.dispatchDue();

        assertThat(sent).isEqualTo(1);
        assertThat(row.getStatus()).isEqualTo(NotificationOutbox.SENT);
        assertThat(row.getSentAt()).isEqualTo(NOW);
        assertThat(sender.deliveredFileCount()).isEqualTo(1);
    }

    @Test
    void offlineSinkFailsVisiblyAndIsResentAfterRecovery() throws Exception {
        NotificationOutbox row = pending(2L);
        sender.setAvailable(false);

        assertThat(worker.dispatchDue()).isZero();
        assertThat(row.getStatus()).isEqualTo(NotificationOutbox.FAILED);
        assertThat(row.getLastError()).contains("offline");
        assertThat(sender.deliveredFileCount()).isZero();
        assertThat(Files.list(deliveryDir).filter(path -> path.toString().endsWith(".json")).count()).isZero();

        sender.setAvailable(true);
        assertThat(worker.dispatchDue()).isEqualTo(1);
        assertThat(row.getStatus()).isEqualTo(NotificationOutbox.SENT);
        assertThat(row.getAttempts()).isEqualTo(2);
        assertThat(sender.deliveredFileCount()).isEqualTo(1);
    }

    @Test
    void exhaustedNotificationIsNotRetriedForever() {
        NotificationOutbox row = pending(3L);
        for (int attempt = 0; attempt < 5; attempt++) {
            row.markFailed("boom", NOW);
        }

        assertThat(worker.dispatchDue()).isZero();
        assertThat(row.getAttempts()).isEqualTo(5);
    }

    @Test
    void exhaustedNotificationIsRequeuedExplicitlyAndDeliveredExactlyOnce() {
        NotificationOutbox row = pending(4L);
        for (int attempt = 0; attempt < 5; attempt++) {
            row.markFailed("sink offline", NOW);
        }
        assertThat(worker.dispatchDue()).isZero();
        assertThat(row.getStatus()).isEqualTo(NotificationOutbox.FAILED);

        assertThat(worker.requeueAndDispatch(4L)).isTrue();
        assertThat(row.getStatus()).isEqualTo(NotificationOutbox.SENT);
        assertThat(row.getAttempts()).isEqualTo(1);
        assertThat(sender.deliveredFileCount()).isEqualTo(1);

        // 幂等：已 SENT 的通知不会被再次投递，也不会产生第二个文件
        assertThat(worker.requeueAndDispatch(4L)).isFalse();
        assertThat(sender.deliveredFileCount()).isEqualTo(1);
    }

    @Test
    void failedEnqueueRecordIsRequeuedIntoOutboxThenDelivered() {
        NotificationRetry retry = new NotificationRetry("SMS", "00000000006", "INSTALLMENT_CREATED",
                "planId=IP9", "insert denied", NOW);
        try {
            var field = NotificationRetry.class.getDeclaredField("retryId");
            field.setAccessible(true);
            field.set(retry, 1L);
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException(ex);
        }
        retries.put(1L, retry);
        when(repository.saveAndFlush(any(NotificationOutbox.class))).thenAnswer(invocation -> {
            NotificationOutbox outbox = invocation.getArgument(0);
            setField(outbox, 9L);
            rows.put(9L, outbox);
            return outbox;
        });

        int delivered = worker.dispatchDue();

        assertThat(retries).isEmpty();
        assertThat(delivered).isEqualTo(1);
        assertThat(rows.get(9L).getStatus()).isEqualTo(NotificationOutbox.SENT);
        assertThat(sender.deliveredFileCount()).isEqualTo(1);
    }
}
