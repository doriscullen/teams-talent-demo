package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.PrincipalAllocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PrincipalAllocationRepository extends JpaRepository<PrincipalAllocation, Long> {

    List<PrincipalAllocation> findByTransactionIdIn(Collection<String> transactionIds);

    Optional<PrincipalAllocation> findFirstByTransactionId(String transactionId);

    boolean existsByTransactionId(String transactionId);

    void deleteByPlanId(String planId);

    @Query("select coalesce(sum(a.principalAmount), 0) from PrincipalAllocation a where a.transactionId = :transactionId")
    java.math.BigDecimal allocatedAmount(@Param("transactionId") String transactionId);
}
