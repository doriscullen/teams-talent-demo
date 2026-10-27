package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.NotificationPort;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** 通知发件箱写入（A-05）：失败只记录，不影响分期资金主流程。 */
@Component
public class NotificationOutboxWriter implements NotificationPort {

    private static final Logger log = LoggerFactory.getLogger(NotificationOutboxWriter.class);

    private final NotificationOutboxRepository repository;
    private final ClockProvider clock;

    public NotificationOutboxWriter(NotificationOutboxRepository repository, ClockProvider clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    public void enqueue(String channel, String recipient, String template, String payload) {
        try {
            repository.save(new NotificationOutbox(channel, recipient, template, payload, clock.now()));
        } catch (RuntimeException ex) {
            log.warn("notification enqueue failed: template={} recipient={}", template, recipient);
        }
    }
}
