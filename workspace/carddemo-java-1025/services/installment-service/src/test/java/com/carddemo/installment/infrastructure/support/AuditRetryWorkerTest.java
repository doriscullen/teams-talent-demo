package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.AuditEvent;
import com.carddemo.installment.domain.model.AuditRetry;
import com.carddemo.installment.domain.repository.AuditEventRepository;
import com.carddemo.installment.domain.repository.AuditRetryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 审计补偿消费（C-07）：队列真实落库为审计事件后清空，不会永久 PENDING。 */
class AuditRetryWorkerTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 27, 10, 0);

    private AuditRetryRepository retryRepository;
    private AuditEventRepository eventRepository;
    private AuditRetryWorker worker;
    private final List<AuditRetry> queue = new ArrayList<>();

    @BeforeEach
    void setUp() {
        retryRepository = mock(AuditRetryRepository.class);
        eventRepository = mock(AuditEventRepository.class);
        ClockProvider clock = mock(ClockProvider.class);
        when(clock.now()).thenReturn(NOW);

        when(retryRepository.findAll(any(org.springframework.data.domain.Sort.class)))
                .thenAnswer(invocation -> List.copyOf(queue));
        when(retryRepository.findById(any())).thenAnswer(invocation -> {
            Long id = invocation.getArgument(0);
            return queue.stream().filter(item -> id.equals(item.getRetryId())).findFirst();
        });
        when(retryRepository.count()).thenAnswer(invocation -> (long) queue.size());
        org.mockito.Mockito.doAnswer(invocation -> {
            queue.remove(invocation.getArgument(0));
            return null;
        }).when(retryRepository).delete(any(AuditRetry.class));

        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        worker = new AuditRetryWorker(retryRepository, eventRepository, clock, txManager, true);
    }

    private void enqueue(long id) {
        AuditRetry retry = new AuditRetry("USER0001", "INSTALLMENT_BACKOFFICE_QUERYED", "INSTALLMENT_PLAN",
                "00000000006", "page=1", "db down", NOW);
        try {
            var field = AuditRetry.class.getDeclaredField("retryId");
            field.setAccessible(true);
            field.set(retry, id);
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException(ex);
        }
        queue.add(retry);
    }

    @Test
    void queuedAuditIsReplayedIntoAuditEventsAndRemoved() {
        enqueue(1L);

        int replayed = worker.replayQueue();

        ArgumentCaptor<AuditEvent> captor = ArgumentCaptor.forClass(AuditEvent.class);
        verify(eventRepository).save(captor.capture());
        assertThat(captor.getValue().getAction()).isEqualTo("INSTALLMENT_BACKOFFICE_QUERYED");
        assertThat(replayed).isEqualTo(1);
        assertThat(worker.pendingCount()).isZero();
    }

    @Test
    void emptyQueueIsNoOp() {
        assertThat(worker.replayQueue()).isZero();
        verify(eventRepository, org.mockito.Mockito.never()).save(any());
    }
}
