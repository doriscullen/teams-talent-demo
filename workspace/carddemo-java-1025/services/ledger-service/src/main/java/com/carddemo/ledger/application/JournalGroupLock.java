package com.carddemo.ledger.application;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;

/**
 * 分录组并发闸门（A-002）：同 entryGroupId 的并发过账先取事务级 advisory lock，
 * 保证「查存在 → 写入」之间不会被第二个请求插入同一分组（否则主键冲突会变成 500/503）。
 */
@Component
public class JournalGroupLock {

    @PersistenceContext
    private EntityManager entityManager;

    public void acquire(String entryGroupId) {
        entityManager.createNativeQuery("select pg_advisory_xact_lock(hashtext(:key))")
                .setParameter("key", entryGroupId)
                .getSingleResult();
    }
}
