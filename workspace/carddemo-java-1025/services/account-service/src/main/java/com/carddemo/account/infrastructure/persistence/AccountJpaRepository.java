package com.carddemo.account.infrastructure.persistence;

import com.carddemo.account.domain.model.Account;
import com.carddemo.account.domain.repository.AccountRepository;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface AccountJpaRepository extends JpaRepository<Account, String>, AccountRepository {

    @Override
    default Optional<Account> findByAccountId(String accountId) {
        return findById(accountId);
    }

    @Override
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Account a where a.accountId = :accountId")
    Optional<Account> findForUpdate(@Param("accountId") String accountId);

    @Override
    default Account saveAccount(Account account) {
        return save(account);
    }

    @Override
    default List<Account> findAllAccounts() {
        return findAll();
    }
}
