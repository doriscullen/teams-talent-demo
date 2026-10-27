package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.SettlementIntent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SettlementIntentRepository extends JpaRepository<SettlementIntent, String> {
}
