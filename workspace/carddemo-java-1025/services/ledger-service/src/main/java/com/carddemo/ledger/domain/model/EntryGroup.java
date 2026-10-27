package com.carddemo.ledger.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/** 分录组（幂等单元）：同一 entryGroupId 只允许一组分录。 */
@Entity
@Table(name = "ledger_entry_group")
public class EntryGroup {

    @Id
    @Column(name = "entry_group_id", length = 64, nullable = false, updatable = false)
    private String entryGroupId;

    @Column(name = "business_type", length = 40, nullable = false)
    private String businessType;

    @Column(name = "reference_id", length = 64, nullable = false)
    private String referenceId;

    @Column(name = "line_count", nullable = false)
    private int lineCount;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected EntryGroup() {
        // for JPA
    }

    public EntryGroup(String entryGroupId, String businessType, String referenceId, int lineCount,
                      LocalDateTime createdAt) {
        this.entryGroupId = entryGroupId;
        this.businessType = businessType;
        this.referenceId = referenceId;
        this.lineCount = lineCount;
        this.createdAt = createdAt;
    }

    public String getEntryGroupId() {
        return entryGroupId;
    }

    public String getBusinessType() {
        return businessType;
    }

    public String getReferenceId() {
        return referenceId;
    }

    public int getLineCount() {
        return lineCount;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
