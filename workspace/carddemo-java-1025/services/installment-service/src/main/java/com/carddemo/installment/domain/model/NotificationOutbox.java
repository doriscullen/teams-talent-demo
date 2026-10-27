package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 通知发件箱（A-05 / C-03）：先落发件箱，失败不回滚分期主流程；
 * 由本地投递 worker 真实投递并把结果写回（SENT + sentAt，或 FAILED + lastError 待补发）。
 */
@Entity
@Table(name = "installment_notification_outbox")
public class NotificationOutbox {

    public static final String PENDING = "PENDING";
    public static final String SENDING = "SENDING";
    public static final String SENT = "SENT";
    public static final String FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "notification_id")
    private Long notificationId;

    @Column(name = "channel", length = 16, nullable = false)
    private String channel;

    @Column(name = "recipient", length = 64, nullable = false)
    private String recipient;

    @Column(name = "template", length = 40, nullable = false)
    private String template;

    @Column(name = "payload", length = 2000)
    private String payload;

    @Column(name = "status", length = 16, nullable = false)
    private String status;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error", length = 200)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    protected NotificationOutbox() {
        // for JPA
    }

    public NotificationOutbox(String channel, String recipient, String template, String payload,
                              LocalDateTime createdAt) {
        this.channel = channel;
        this.recipient = recipient;
        this.template = template;
        this.payload = payload;
        this.status = PENDING;
        this.attempts = 0;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public void markSent(LocalDateTime at) {
        this.status = SENT;
        this.attempts = attempts + 1;
        this.sentAt = at;
        this.updatedAt = at;
    }

    public void markFailed(String error, LocalDateTime at) {
        this.status = FAILED;
        this.attempts = attempts + 1;
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 200));
        this.updatedAt = at;
    }

    public void markPending(LocalDateTime at) {
        this.status = PENDING;
        this.updatedAt = at;
    }

    public Long getNotificationId() {
        return notificationId;
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

    public String getStatus() {
        return status;
    }

    public int getAttempts() {
        return attempts;
    }

    public String getLastError() {
        return lastError;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getSentAt() {
        return sentAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
