package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InstallmentScheduleRepository extends JpaRepository<InstallmentSchedule, String> {

    List<InstallmentSchedule> findByPlanIdOrderByInstallmentNo(String planId);

    void deleteByPlanId(String planId);
}
