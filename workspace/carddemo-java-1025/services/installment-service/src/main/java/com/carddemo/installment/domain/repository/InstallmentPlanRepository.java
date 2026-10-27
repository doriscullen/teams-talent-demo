package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.PlanStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface InstallmentPlanRepository extends JpaRepository<InstallmentPlan, String> {

    Optional<InstallmentPlan> findByIdempotencyKey(String idempotencyKey);

    long countByAccountIdAndStatus(String accountId, PlanStatus status);

    Page<InstallmentPlan> findByAccountId(String accountId, Pageable pageable);

    Page<InstallmentPlan> findByAccountIdAndStatus(String accountId, PlanStatus status, Pageable pageable);

    Page<InstallmentPlan> findByStatus(PlanStatus status, Pageable pageable);

    Page<InstallmentPlan> findAll(Pageable pageable);

    List<InstallmentPlan> findByAccountIdAndStatusIn(String accountId, Collection<PlanStatus> statuses);
}
