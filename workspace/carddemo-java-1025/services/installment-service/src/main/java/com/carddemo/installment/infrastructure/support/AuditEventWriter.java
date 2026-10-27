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

/**
 * 审计落库（§6.1）。写失败不得回滚业务：转为本地补偿队列（§11.1），队列也失败时仅记录错误。
 */
@Component
public class AuditEventWriter implements AuditPort {

    private static final Logger log = LoggerFactory.getLogger(AuditEventWriter.class);

    private final AuditEventRepository auditEventRepository;
    private final AuditRetryRepository auditRetryRepository;
    private final ClockProvider clock;

    public AuditEventWriter(AuditEventRepository auditEventRepository,
                            AuditRetryRepository auditRetryRepository,
                            ClockProvider clock) {
        this.auditEventRepository = auditEventRepository;
        this.auditRetryRepository = auditRetryRepository;
        this.clock = clock;
    }

    @Override
    public void record(String actor, String action, String resourceType, String resourceId, String payload) {
        try {
            auditEventRepository.save(new AuditEvent(actor, action, resourceType, resourceId, payload, clock.now()));
        } catch (RuntimeException ex) {
            log.warn("audit write failed, queueing retry: action={} resource={}", action, resourceId);
            try {
                auditRetryRepository.save(new AuditRetry(actor, action, resourceType, resourceId, payload,
                        truncate(ex.getMessage()), clock.now()));
            } catch (RuntimeException retryFailure) {
                log.error("audit retry queue write also failed for action={} resource={}", action, resourceId);
            }
        }
    }

    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        return message.length() <= 200 ? message : message.substring(0, 200);
    }
}
