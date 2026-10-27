package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentRate;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InstallmentRateRepository extends JpaRepository<InstallmentRate, Integer> {
}
