package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.AuditEvent;
import com.carddemo.installment.domain.model.AuditRetry;
import com.carddemo.installment.domain.repository.AuditEventRepository;
import com.carddemo.installment.domain.repository.AuditRetryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

/**
 * 审计补偿消费者（C-07）：审计写失败进入 installment_audit_retry，
 * 本 worker 逐条重放为真实 audit 事件后删除队列记录，队列不会被永久 PENDING。
 */
@Component
public class AuditRetryWorker {

    private static final Logger log = LoggerFactory.getLogger(AuditRetryWorker.class);

    private final AuditRetryRepository retryRepository;
    private final AuditEventRepository eventRepository;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;
    private final boolean schedulingEnabled;

    public AuditRetryWorker(AuditRetryRepository retryRepository, AuditEventRepository eventRepository,
                            ClockProvider clock, PlatformTransactionManager transactionManager,
                            @org.springframework.beans.factory.annotation.Value(
                                    "${installment.workers.enabled:true}") boolean schedulingEnabled) {
        this.retryRepository = retryRepository;
        this.eventRepository = eventRepository;
        this.clock = clock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.schedulingEnabled = schedulingEnabled;
    }

    @Scheduled(fixedDelayString = "${installment.audit.retry-delay-ms:5000}",
            initialDelayString = "${installment.audit.initial-delay-ms:2000}")
    public void scheduledReplay() {
        if (!schedulingEnabled) {
            return;
        }
        try {
            replayQueue();
        } catch (RuntimeException ex) {
            log.warn("audit retry replay round failed: {}", ex.getMessage());
        }
    }

    /** 重放队列，返回本轮成功重放条数。 */
    public int replayQueue() {
        List<AuditRetry> queue = retryRepository.findAll(Sort.by(Sort.Direction.ASC, "retryId"));
        int replayed = 0;
        for (AuditRetry retry : queue) {
            Boolean done = transactionTemplate.execute(status -> {
                AuditRetry item = retryRepository.findById(retry.getRetryId()).orElse(null);
                if (item == null) {
                    return false;
                }
                eventRepository.save(new AuditEvent(item.getActor(), item.getAction(), item.getResourceType(),
                        item.getResourceId(), item.getPayload(), item.getCreatedAt()));
                retryRepository.delete(item);
                return true;
            });
            if (Boolean.TRUE.equals(done)) {
                replayed++;
            }
        }
        if (replayed > 0) {
            log.info("audit retry queue replayed {} event(s) at {}", replayed, clock.now());
        }
        return replayed;
    }

    public long pendingCount() {
        return retryRepository.count();
    }
}
