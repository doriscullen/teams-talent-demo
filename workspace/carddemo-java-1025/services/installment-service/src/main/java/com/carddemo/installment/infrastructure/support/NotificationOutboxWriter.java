package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.model.NotificationRetry;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import com.carddemo.installment.domain.repository.NotificationRetryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 通知发件箱写入（A-05 / R-C-01）：业务提交后入队，入队失败只影响通知本身；
 * 失败记录写入独立的 {@code installment_notification_retry}（独立事务），
 * 由 {@link NotificationWorker} 重新入队后投递，期间不阻塞也不回滚分期主流程。
 */
@Component
public class NotificationOutboxWriter implements NotificationPort {

    private static final Logger log = LoggerFactory.getLogger(NotificationOutboxWriter.class);

    private final NotificationOutboxRepository repository;
    private final NotificationRetryRepository retryRepository;
    private final ClockProvider clock;
    private final SideEffectTransactions sideEffects;

    public NotificationOutboxWriter(NotificationOutboxRepository repository,
                                    NotificationRetryRepository retryRepository,
                                    ClockProvider clock,
                                    SideEffectTransactions sideEffects) {
        this.repository = repository;
        this.retryRepository = retryRepository;
        this.clock = clock;
        this.sideEffects = sideEffects;
    }

    @Override
    public void enqueue(String channel, String recipient, String template, String payload) {
        sideEffects.afterCommit(() -> enqueueNow(channel, recipient, template, payload));
    }

    void enqueueNow(String channel, String recipient, String template, String payload) {
        try {
            sideEffects.inNewTransaction(() -> repository.save(
                    new NotificationOutbox(channel, recipient, template, payload, clock.now())));
        } catch (RuntimeException ex) {
            log.warn("notification enqueue failed, queueing retry: template={} recipient={}", template, recipient);
            queueRetry(channel, recipient, template, payload, ex);
        }
    }

    private void queueRetry(String channel, String recipient, String template, String payload,
                            RuntimeException failure) {
        try {
            sideEffects.inNewTransaction(() -> retryRepository.save(new NotificationRetry(channel, recipient,
                    template, payload, failure.getMessage(), clock.now())));
        } catch (RuntimeException ex) {
            log.error("notification retry queue write failed: template={} recipient={}", template, recipient, ex);
        }
    }
}
