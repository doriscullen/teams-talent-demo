package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.SettlementIntent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.Optional;

public interface SettlementIntentRepository extends JpaRepository<SettlementIntent, String> {

    /** 同一计划的在途结清意图（异键并发只允许一条，A-001；FAILED 不占在途，A-R005）。 */
    Optional<SettlementIntent> findFirstByPlanIdAndStatusIn(String planId, Collection<String> statuses);
}
