package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/** 后台导出文件（US-008）：CSV 24 小时内可下载，过期 410。 */
@Entity
@Table(name = "installment_export_file")
public class ExportFile {

    @Id
    @Column(name = "export_id", length = 40, nullable = false, updatable = false)
    private String exportId;

    @Column(name = "requested_by", length = 8, nullable = false)
    private String requestedBy;

    @Column(name = "row_count", nullable = false)
    private int rowCount;

    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    protected ExportFile() {
        // for JPA
    }

    public ExportFile(String exportId, String requestedBy, int rowCount, String content,
                      LocalDateTime createdAt, LocalDateTime expiresAt) {
        this.exportId = exportId;
        this.requestedBy = requestedBy;
        this.rowCount = rowCount;
        this.content = content;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public boolean isExpired(LocalDateTime now) {
        return !now.isBefore(expiresAt);
    }

    public String getExportId() {
        return exportId;
    }

    public String getRequestedBy() {
        return requestedBy;
    }

    public int getRowCount() {
        return rowCount;
    }

    public String getContent() {
        return content;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }
}
