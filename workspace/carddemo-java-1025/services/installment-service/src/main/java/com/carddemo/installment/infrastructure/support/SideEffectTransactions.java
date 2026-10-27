package com.carddemo.installment.infrastructure.support;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 非关键副作用的事务边界（R-C-01）：
 * <ul>
 *   <li>有业务事务时，副作用等业务提交后才执行，避免回滚后仍发送通知；</li>
 *   <li>每次副作用都在独立事务（REQUIRES_NEW）中执行，INSERT 失败只回滚它自己，
 *       不会把业务事务标记为 rollback-only，也不会在已中止的事务里写重试队列；</li>
 *   <li>没有事务时直接执行。</li>
 * </ul>
 */
@Component
public class SideEffectTransactions {

    private final TransactionTemplate requiresNew;

    public SideEffectTransactions(PlatformTransactionManager transactionManager) {
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 业务事务提交后执行（无事务时立即执行），并在独立事务中运行。 */
    public void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    inNewTransaction(action);
                }
            });
        } else {
            inNewTransaction(action);
        }
    }

    /** 立即在独立事务中执行；失败异常向调用方抛出，由调用方决定是否入补偿队列。 */
    public void inNewTransaction(Runnable action) {
        requiresNew.executeWithoutResult(status -> action.run());
    }
}
