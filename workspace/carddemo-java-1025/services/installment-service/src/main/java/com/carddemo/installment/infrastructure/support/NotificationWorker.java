package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

/**
 * 通知投递 worker（C-03）：认领 PENDING/FAILED 通知并真实投递。
 * 投递失败写回 FAILED + lastError + attempts，恢复后同一 worker 会补发；主资金流程不受影响。
 */
@Component
public class NotificationWorker {

    private static final Logger log = LoggerFactory.getLogger(NotificationWorker.class);
    private static final int MAX_ATTEMPTS = 5;

    private final NotificationOutboxRepository repository;
    private final LocalNotificationSender sender;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;
    private final boolean schedulingEnabled;

    public NotificationWorker(NotificationOutboxRepository repository, LocalNotificationSender sender,
                              ClockProvider clock, PlatformTransactionManager transactionManager,
                              @org.springframework.beans.factory.annotation.Value(
                                      "${installment.workers.enabled:true}") boolean schedulingEnabled) {
        this.repository = repository;
        this.sender = sender;
        this.clock = clock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.schedulingEnabled = schedulingEnabled;
    }

    @Scheduled(fixedDelayString = "${installment.notification.dispatch-delay-ms:3000}",
            initialDelayString = "${installment.notification.initial-delay-ms:2000}")
    public void scheduledDispatch() {
        if (!schedulingEnabled) {
            return;
        }
        try {
            dispatchDue();
        } catch (RuntimeException ex) {
            log.warn("notification dispatch round failed: {}", ex.getMessage());
        }
    }

    /** 执行一轮投递，返回本轮成功投递数。 */
    public int dispatchDue() {
        List<NotificationOutbox> due = repository.findByStatusInOrderByNotificationIdAsc(
                List.of(NotificationOutbox.PENDING, NotificationOutbox.FAILED,
                        NotificationOutbox.SENDING));
        int sent = 0;
        for (NotificationOutbox notification : due) {
            if (notification.getAttempts() >= MAX_ATTEMPTS) {
                continue;
            }
            if (notification.getStatus().equals(NotificationOutbox.SENDING)) {
                // 上一轮残留的认领（进程重启等），允许重新认领
                sent += attempt(notification.getNotificationId(), false) ? 1 : 0;
                continue;
            }
            sent += attempt(notification.getNotificationId(), true) ? 1 : 0;
        }
        return sent;
    }

    private boolean attempt(Long notificationId, boolean claim) {
        Boolean delivered = transactionTemplate.execute(status -> {
            if (claim && repository.claim(notificationId) != 1) {
                return false;
            }
            NotificationOutbox notification = repository.findById(notificationId).orElse(null);
            if (notification == null) {
                return false;
            }
            try {
                sender.send(notification);
                notification.markSent(clock.now());
                repository.saveAndFlush(notification);
                return true;
            } catch (Exception ex) {
                notification.markFailed(ex.getMessage(), clock.now());
                repository.saveAndFlush(notification);
                log.warn("notification delivery failed: id={} error={}",
                        notificationId, ex.getMessage());
                return false;
            }
        });
        return Boolean.TRUE.equals(delivered);
    }
}
