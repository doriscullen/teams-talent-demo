package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.AccountLockRow;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface AccountLockRepository extends JpaRepository<AccountLockRow, String> {

    @Modifying
    @Query(value = "INSERT INTO installment_account_lock (account_id) VALUES (:accountId) ON CONFLICT (account_id) DO NOTHING",
            nativeQuery = true)
    void ensureExists(@Param("accountId") String accountId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select l from AccountLockRow l where l.accountId = :accountId")
    Optional<AccountLockRow> lockByAccountId(@Param("accountId") String accountId);
}
