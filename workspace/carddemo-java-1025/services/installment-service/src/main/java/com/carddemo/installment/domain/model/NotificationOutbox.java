package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/** 通知发件箱（A-05：通知失败不回滚分期主流程，可补发）。 */
@Entity
@Table(name = "installment_notification_outbox")
public class NotificationOutbox {

    public static final String PENDING = "PENDING";
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
    }

    public void markSent() {
        this.status = SENT;
        this.attempts = attempts + 1;
    }

    public void markFailed(String error) {
        this.status = FAILED;
        this.attempts = attempts + 1;
        this.lastError = error;
    }

    public Long getNotificationId() {
        return notificationId;
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
}
