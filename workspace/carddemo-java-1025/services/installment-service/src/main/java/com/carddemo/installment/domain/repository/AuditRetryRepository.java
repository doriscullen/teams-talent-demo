package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.AuditRetry;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditRetryRepository extends JpaRepository<AuditRetry, Long> {
}
