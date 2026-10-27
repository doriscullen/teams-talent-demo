package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.NotificationRetry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NotificationRetryRepository extends JpaRepository<NotificationRetry, Long> {

    List<NotificationRetry> findAllByOrderByRetryIdAsc();
}
