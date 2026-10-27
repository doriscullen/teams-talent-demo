package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/** 审计事件（§6.1/§8.2）：actor/action/resource/payload/时间。 */
@Entity
@Table(name = "installment_audit_event")
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "audit_id")
    private Long auditId;

    @Column(name = "actor", length = 8, nullable = false)
    private String actor;

    @Column(name = "action", length = 40, nullable = false)
    private String action;

    @Column(name = "resource_type", length = 32, nullable = false)
    private String resourceType;

    @Column(name = "resource_id", length = 64, nullable = false)
    private String resourceId;

    @Column(name = "payload", length = 2000)
    private String payload;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected AuditEvent() {
        // for JPA
    }

    public AuditEvent(String actor, String action, String resourceType, String resourceId,
                      String payload, LocalDateTime createdAt) {
        this.actor = actor;
        this.action = action;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.payload = payload;
        this.createdAt = createdAt;
    }

    public Long getAuditId() {
        return auditId;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
