package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentApplicationIntent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface InstallmentApplicationIntentRepository
        extends JpaRepository<InstallmentApplicationIntent, String> {

    Optional<InstallmentApplicationIntent> findByIdempotencyKey(String idempotencyKey);

    List<InstallmentApplicationIntent> findByStatusInAndUpdatedAtBefore(List<String> statuses, LocalDateTime before);
}
