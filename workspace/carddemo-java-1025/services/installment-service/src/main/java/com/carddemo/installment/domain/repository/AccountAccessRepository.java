package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.AccountAccess;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AccountAccessRepository extends JpaRepository<AccountAccess, AccountAccess.Key> {

    boolean existsByAccountIdAndUserId(String accountId, String userId);
}
