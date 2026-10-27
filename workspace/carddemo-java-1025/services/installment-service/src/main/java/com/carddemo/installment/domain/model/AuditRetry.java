package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/** 审计写失败时的本地补偿队列（§11.1：audit 写失败进入重试队列）。 */
@Entity
@Table(name = "installment_audit_retry")
public class AuditRetry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "retry_id")
    private Long retryId;

    @Column(name = "actor", length = 8)
    private String actor;

    @Column(name = "action", length = 40)
    private String action;

    @Column(name = "resource_type", length = 32)
    private String resourceType;

    @Column(name = "resource_id", length = 64)
    private String resourceId;

    @Column(name = "payload", length = 2000)
    private String payload;

    @Column(name = "last_error", length = 200)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected AuditRetry() {
        // for JPA
    }

    public AuditRetry(String actor, String action, String resourceType, String resourceId,
                      String payload, String lastError, LocalDateTime createdAt) {
        this.actor = actor;
        this.action = action;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.payload = payload;
        this.lastError = lastError;
        this.createdAt = createdAt;
    }

    public Long getRetryId() {
        return retryId;
    }

    public String getActor() {
        return actor;
    }

    public String getAction() {
        return action;
    }

    public String getResourceType() {
        return resourceType;
    }

    public String getResourceId() {
        return resourceId;
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
