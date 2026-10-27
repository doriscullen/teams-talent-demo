package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.PlanStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface InstallmentPlanRepository extends JpaRepository<InstallmentPlan, String> {

    Optional<InstallmentPlan> findByIdempotencyKey(String idempotencyKey);

    /** 结清/还款的计划级串行化：同一计划的资金动作在持锁事务内判定。 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from InstallmentPlan p where p.planId = :planId")
    Optional<InstallmentPlan> findForUpdate(@Param("planId") String planId);

    long countByAccountIdAndStatus(String accountId, PlanStatus status);

    Page<InstallmentPlan> findByAccountId(String accountId, Pageable pageable);

    Page<InstallmentPlan> findByAccountIdAndStatus(String accountId, PlanStatus status, Pageable pageable);

    Page<InstallmentPlan> findByStatus(PlanStatus status, Pageable pageable);

    Page<InstallmentPlan> findAll(Pageable pageable);

    List<InstallmentPlan> findByAccountIdAndStatusIn(String accountId, Collection<PlanStatus> statuses);
}
