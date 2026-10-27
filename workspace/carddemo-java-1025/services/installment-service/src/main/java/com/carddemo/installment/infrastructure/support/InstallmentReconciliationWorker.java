package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.InstallmentApplicationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 创建意图对账（A-002）：定期续跑停滞意图，避免出现「无计划的有效入账」。 */
@Component
public class InstallmentReconciliationWorker {

    private static final Logger log = LoggerFactory.getLogger(InstallmentReconciliationWorker.class);

    private final InstallmentApplicationService applicationService;
    private final boolean schedulingEnabled;

    public InstallmentReconciliationWorker(InstallmentApplicationService applicationService,
                                           @org.springframework.beans.factory.annotation.Value(
                                                   "${installment.workers.enabled:true}") boolean schedulingEnabled) {
        this.applicationService = applicationService;
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
            if (completed > 0) {
                log.info("installment reconciliation resumed {} pending intent(s)", completed);
            }
        } catch (RuntimeException ex) {
            log.warn("installment reconciliation round failed: {}", ex.getMessage());
        }
    }
}
