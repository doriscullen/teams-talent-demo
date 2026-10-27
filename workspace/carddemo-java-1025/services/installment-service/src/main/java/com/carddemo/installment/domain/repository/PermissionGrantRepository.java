package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.PermissionGrant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PermissionGrantRepository extends JpaRepository<PermissionGrant, PermissionGrant.Key> {

    List<PermissionGrant> findByUserId(String userId);

    boolean existsByUserIdAndPermission(String userId, String permission);
}
