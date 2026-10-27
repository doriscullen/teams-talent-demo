package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.AuditEvent;
import com.carddemo.installment.domain.model.AuditRetry;
import com.carddemo.installment.domain.repository.AuditEventRepository;
import com.carddemo.installment.domain.repository.AuditRetryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * 审计落库（§6.1 / R-C-01）：业务提交后写审计，写失败不得影响业务，
 * 也不得在已中止的事务里入队——失败记录通过独立事务写入 {@code installment_audit_retry}，
 * 由 {@link AuditRetryWorker} 真实重放。
 */
@Component
public class AuditEventWriter implements AuditPort {

    private static final Logger log = LoggerFactory.getLogger(AuditEventWriter.class);

    private final AuditEventRepository auditEventRepository;
    private final AuditRetryRepository auditRetryRepository;
    private final ClockProvider clock;
    private final SideEffectTransactions sideEffects;

    public AuditEventWriter(AuditEventRepository auditEventRepository,
                            AuditRetryRepository auditRetryRepository,
                            ClockProvider clock,
                            SideEffectTransactions sideEffects) {
        this.auditEventRepository = auditEventRepository;
        this.auditRetryRepository = auditRetryRepository;
        this.clock = clock;
        this.sideEffects = sideEffects;
    }

    @Override
    public void record(String actor, String action, String resourceType, String resourceId, String payload) {
        LocalDateTime now = clock.now();
        sideEffects.submit(
                () -> auditEventRepository.save(
                        new AuditEvent(actor, action, resourceType, resourceId, payload, now)),
                failure -> {
                    log.warn("audit write failed, queueing retry: action={} resource={}", action, resourceId);
                    queueRetry(actor, action, resourceType, resourceId, payload, failure, now);
                });
    }

    /** 补偿：在另一条独立事务中写重试队列，由 {@link AuditRetryWorker} 真实重放。 */
    private void queueRetry(String actor, String action, String resourceType, String resourceId,
                            String payload, RuntimeException failure, LocalDateTime now) {
        try {
            sideEffects.executeIsolated(() -> auditRetryRepository.save(new AuditRetry(actor, action,
                    resourceType, resourceId, payload, truncate(failure.getMessage()), now)));
        } catch (RuntimeException ex) {
            // 整个库不可用时业务事务本身也已失败，这里只显式记录，不伪造成功
            log.error("audit retry queue write also failed for action={} resource={}", action, resourceId, ex);
        }
    }

    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        return message.length() <= 200 ? message : message.substring(0, 200);
    }
}
