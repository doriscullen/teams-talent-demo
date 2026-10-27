package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.model.NotificationOutbox;
import com.carddemo.installment.domain.model.NotificationRetry;
import com.carddemo.installment.domain.repository.NotificationOutboxRepository;
import com.carddemo.installment.domain.repository.NotificationRetryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

/**
 * 通知投递 worker（C-03 / R-C-03）：
 * <ul>
 *   <li>认领 PENDING/FAILED 通知并真实投递，失败写回 FAILED + lastError + attempts（自动重试有界 5 次）；</li>
 *   <li>入队失败的补偿记录（installment_notification_retry）在每轮开始时重新入队；</li>
 *   <li>超过自动重试上限后，可由客服通过显式幂等重排入口恢复，恢复后仍只投递一次。</li>
 * </ul>
 */
@Component
public class NotificationWorker {

    private static final Logger log = LoggerFactory.getLogger(NotificationWorker.class);
    private static final int MAX_ATTEMPTS = 5;

    private final NotificationOutboxRepository repository;
    private final NotificationRetryRepository retryRepository;
    private final LocalNotificationSender sender;
    private final ClockProvider clock;
    private final TransactionTemplate transactionTemplate;
    private final boolean schedulingEnabled;

    public NotificationWorker(NotificationOutboxRepository repository,
                              NotificationRetryRepository retryRepository,
                              LocalNotificationSender sender,
                              ClockProvider clock,
                              PlatformTransactionManager transactionManager,
                              @org.springframework.beans.factory.annotation.Value(
                                      "${installment.workers.enabled:true}") boolean schedulingEnabled) {
        this.repository = repository;
        this.retryRepository = retryRepository;
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

    /** 执行一轮：先重排入队失败记录，再投递到期通知，返回本轮成功投递数。 */
    public int dispatchDue() {
        requeueFailedEnqueues();
        List<NotificationOutbox> due = repository.findByStatusInOrderByNotificationIdAsc(
                List.of(NotificationOutbox.PENDING, NotificationOutbox.FAILED,
                        NotificationOutbox.SENDING));
        int sent = 0;
        for (NotificationOutbox notification : due) {
            if (notification.getAttempts() >= MAX_ATTEMPTS) {
                continue;
            }
            boolean claim = !notification.getStatus().equals(NotificationOutbox.SENDING);
            sent += attempt(notification.getNotificationId(), claim) ? 1 : 0;
        }
        return sent;
    }

    /**
     * 显式人工恢复（R-C-03）：仅对未投递成功的通知重置自动重试计数并立即尝试一次投递。
     * 幂等：已 SENT 的通知不会被再次投递，也不会产生第二个投递文件。
     */
    public boolean requeueAndDispatch(Long notificationId) {
        Boolean requeued = transactionTemplate.execute(status -> {
            NotificationOutbox notification = repository.findById(notificationId).orElse(null);
            if (notification == null || NotificationOutbox.SENT.equals(notification.getStatus())) {
                return false;
            }
            notification.requeue(clock.now());
            repository.saveAndFlush(notification);
            return true;
        });
        if (!Boolean.TRUE.equals(requeued)) {
            return false;
        }
        return attempt(notificationId, false);
    }

    /** 把入队失败的补偿记录重新写入发件箱（成功即删除补偿记录）。 */
    public int requeueFailedEnqueues() {
        List<NotificationRetry> pending = retryRepository.findAllByOrderByRetryIdAsc();
        int requeued = 0;
        for (NotificationRetry retry : pending) {
            Boolean done = transactionTemplate.execute(status -> {
                NotificationRetry row = retryRepository.findById(retry.getRetryId()).orElse(null);
                if (row == null) {
                    return false;
                }
                repository.saveAndFlush(new NotificationOutbox(row.getChannel(), row.getRecipient(),
                        row.getTemplate(), row.getPayload(), row.getCreatedAt()));
                retryRepository.delete(row);
                return true;
            });
            if (Boolean.TRUE.equals(done)) {
                requeued++;
            }
        }
        return requeued;
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
                log.warn("notification delivery failed: id={} error={}", notificationId, ex.getMessage());
                return false;
            }
        });
        return Boolean.TRUE.equals(delivered);
    }
}
