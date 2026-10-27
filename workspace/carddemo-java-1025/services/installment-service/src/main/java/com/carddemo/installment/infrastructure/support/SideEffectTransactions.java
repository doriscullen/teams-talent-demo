package com.carddemo.installment.infrastructure.support;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.function.Consumer;

/**
 * 非关键副作用（审计/通知）的事务与连接边界（R-C-01，A-PERF-001 修复）。
 *
 * <p>核心约束：<b>绝不在业务事务的提交回调里借数据库连接</b>。Spring 的 {@code afterCommit}
 * 在外层事务 {@code cleanupAfterCompletion} 之前执行，此时业务连接仍被占用；在其中再开
 * {@code REQUIRES_NEW} 会挂起业务事务并额外申请连接。50 并发时默认 Hikari 池（10）被占满，
 * 业务响应与副作用互相等待 30 秒并出现 500（历史实测 total=10, active=10, waiting=50）。</p>
 *
 * <p>因此副作用分两步，且每条副作用任一时刻只占一条连接：</p>
 * <ol>
 *   <li>{@link #submit(Runnable, Consumer)}：有业务事务时只登记到线程内队列（不碰数据库），
 *       并注册回滚钩子——业务事务回滚时丢弃这些登记；</li>
 *   <li>{@link #flush()}：业务事务结束、连接已归还之后调用（HTTP 请求由
 *       {@code SideEffectFlushFilter} 在 finally 中统一触发；无事务调用点直接执行），
 *       逐条以<b>单层</b> REQUIRES_NEW 事务执行；失败时由补偿动作在<b>另一条</b>独立事务中
 *       写重试队列，绝不嵌套事务。</li>
 * </ol>
 */
@Component
public class SideEffectTransactions {

    private static final Logger log = LoggerFactory.getLogger(SideEffectTransactions.class);

    private record SideEffect(Runnable primary, Consumer<RuntimeException> onFailure) {
    }

    private final TransactionTemplate requiresNew;
    private final ThreadLocal<Deque<SideEffect>> pending = ThreadLocal.withInitial(ArrayDeque::new);

    public SideEffectTransactions(PlatformTransactionManager transactionManager) {
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 登记副作用：有业务事务时延后到 {@link #flush()}（连接归还后）执行；无事务时立即以单层事务执行。
     *
     * @param primary   副作用主体，运行在单独事务中（不得再开启事务）
     * @param onFailure 主体失败后的补偿动作（例如写重试队列），运行在另一条独立事务中；可为 null
     */
    public void submit(Runnable primary, Consumer<RuntimeException> onFailure) {
        SideEffect effect = new SideEffect(primary, onFailure);
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            runOne(effect);
            return;
        }
        Deque<SideEffect> queue = pending.get();
        int mark = queue.size();
        queue.addLast(effect);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    // 业务事务回滚：本事务内登记的副作用不得执行
                    while (queue.size() > mark) {
                        queue.removeLast();
                    }
                }
            }
        });
    }

    /** 执行已登记的副作用；必须在没有活动事务时调用（由请求边界或无事务调用点保证）。 */
    public int flush() {
        Deque<SideEffect> queue = pending.get();
        if (queue.isEmpty()) {
            return 0;
        }
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            // 事务未结束就落库会把连接借在清理之前，正是 A-PERF-001 的根因；宁可延后也不在此执行
            log.warn("side effects left pending: flush called inside an active transaction");
            return 0;
        }
        int executed = 0;
        SideEffect effect;
        while ((effect = queue.pollFirst()) != null) {
            runOne(effect);
            executed++;
        }
        return executed;
    }

    /** 单层独立事务执行（不嵌套、不挂起外层事务；调用点不得持有活动事务）。 */
    public void executeIsolated(Runnable action) {
        requiresNew.executeWithoutResult(status -> action.run());
    }

    private void runOne(SideEffect effect) {
        try {
            executeIsolated(effect.primary());
        } catch (RuntimeException ex) {
            if (effect.onFailure() == null) {
                throw ex;
            }
            effect.onFailure().accept(ex);
        }
    }
}
