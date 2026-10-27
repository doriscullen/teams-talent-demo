package com.carddemo.account.domain.repository;

import com.carddemo.account.domain.model.Account;

import java.util.List;
import java.util.Optional;

/**
 * 账户仓储端口。实现见 infrastructure.persistence.AccountJpaRepository。
 */
public interface AccountRepository {

    Optional<Account> findByAccountId(String accountId);

    /** 行级锁读取：同一账户的还款/记账在持锁事务内判定（A-001）。 */
    Optional<Account> findForUpdate(String accountId);

    Account saveAccount(Account account);

    List<Account> findAllAccounts();
}
