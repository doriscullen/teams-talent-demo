package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 通知入队失败补偿记录（R-C-01）：当 installment_notification_outbox 的 INSERT 被拒绝时，
 * 在本表留下真实可重试的记录（独立事务），恢复后由 worker 重新入队并投递。
 */
@Entity
@Table(name = "installment_notification_retry")
public class NotificationRetry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "retry_id")
    private Long retryId;

    @Column(name = "channel", length = 16, nullable = false)
    private String channel;

    @Column(name = "recipient", length = 64, nullable = false)
    private String recipient;

    @Column(name = "template", length = 40, nullable = false)
    private String template;

    @Column(name = "payload", length = 2000)
    private String payload;

    @Column(name = "last_error", length = 200)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected NotificationRetry() {
        // for JPA
    }

    public NotificationRetry(String channel, String recipient, String template, String payload,
                             String lastError, LocalDateTime createdAt) {
        this.channel = channel;
        this.recipient = recipient;
        this.template = template;
        this.payload = payload;
        this.lastError = lastError == null ? null : lastError.substring(0, Math.min(lastError.length(), 200));
        this.createdAt = createdAt;
    }

    public Long getRetryId() {
        return retryId;
    }

    public String getChannel() {
        return channel;
    }

    public String getRecipient() {
        return recipient;
    }

    public String getTemplate() {
        return template;
    }

    public String getPayload() {
        return payload;
    }

    public String getLastError() {
        return lastError;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
