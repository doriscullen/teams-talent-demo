package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.EligibilityFlag;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EligibilityFlagRepository extends JpaRepository<EligibilityFlag, String> {
}
