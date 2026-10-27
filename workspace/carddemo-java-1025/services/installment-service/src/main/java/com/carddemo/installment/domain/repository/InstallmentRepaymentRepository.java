package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentRepayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface InstallmentRepaymentRepository extends JpaRepository<InstallmentRepayment, String> {

    List<InstallmentRepayment> findByPlanIdOrderByCreatedAtAsc(String planId);

    boolean existsByPlanIdAndStatus(String planId, String status);

    List<InstallmentRepayment> findByStatusInAndUpdatedAtBefore(Collection<String> statuses,
                                                               LocalDateTime before);
}
