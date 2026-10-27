package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.AuditEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditEventRepository extends JpaRepository<AuditEvent, Long> {
}
