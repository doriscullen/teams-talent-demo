package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.InstallmentApplicationService;
import com.carddemo.installment.application.RepaymentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 创建意图对账（A-002）：定期续跑停滞意图，避免出现「无计划的有效入账」。 */
@Component
public class InstallmentReconciliationWorker {

    private static final Logger log = LoggerFactory.getLogger(InstallmentReconciliationWorker.class);

    private final InstallmentApplicationService applicationService;
    private final RepaymentService repaymentService;
    private final SideEffectTransactions sideEffects;
    private final boolean schedulingEnabled;

    public InstallmentReconciliationWorker(InstallmentApplicationService applicationService,
                                           RepaymentService repaymentService,
                                           SideEffectTransactions sideEffects,
                                           @org.springframework.beans.factory.annotation.Value(
                                                   "${installment.workers.enabled:true}") boolean schedulingEnabled) {
        this.applicationService = applicationService;
        this.repaymentService = repaymentService;
        this.sideEffects = sideEffects;
        this.schedulingEnabled = schedulingEnabled;
    }

    @Scheduled(fixedDelayString = "${installment.reconciliation.delay-ms:10000}",
            initialDelayString = "${installment.reconciliation.initial-delay-ms:5000}")
    public void scheduledReconcile() {
        if (!schedulingEnabled) {
            return;
        }
        try {
            int completed = applicationService.reconcilePending();
            int repaid = repaymentService.reconcilePending();
            if (completed > 0 || repaid > 0) {
                log.info("installment reconciliation resumed {} intent(s), {} repayment(s)",
                        completed, repaid);
            }
        } catch (RuntimeException ex) {
            log.warn("installment reconciliation round failed: {}", ex.getMessage());
        } finally {
            // 续跑完成计划时会登记审计副作用；worker 没有 HTTP 请求边界，这里在事务结束后统一落库
            sideEffects.flush();
        }
    }
}
