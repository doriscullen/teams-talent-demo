package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InstallmentPolicyRepository extends JpaRepository<InstallmentPolicy, Short> {
}
