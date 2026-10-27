package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.ExportFile;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExportFileRepository extends JpaRepository<ExportFile, String> {
}
