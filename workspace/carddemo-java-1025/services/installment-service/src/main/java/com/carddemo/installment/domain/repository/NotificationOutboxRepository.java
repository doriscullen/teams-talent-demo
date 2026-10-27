package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.NotificationOutbox;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {
}
