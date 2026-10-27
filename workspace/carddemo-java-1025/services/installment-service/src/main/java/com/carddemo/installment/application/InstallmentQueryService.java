package com.carddemo.installment.application;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.InstallmentPlan;
import com.carddemo.installment.domain.model.InstallmentSchedule;
import com.carddemo.installment.domain.model.PlanStatus;
import com.carddemo.installment.domain.repository.InstallmentPlanRepository;
import com.carddemo.installment.domain.repository.InstallmentScheduleRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 我的分期 / 后台查询（REQ-INS-05/07）：分页与筛选参数服务端校验，越权 404。
 */
@Service
public class InstallmentQueryService {

    public record ScheduleView(int installmentNo, LocalDate dueDate, BigDecimal principalDue,
                               BigDecimal feeDue, BigDecimal totalDue, String status, LocalDateTime paidAt) {
    }

    public record PlanView(String planId, String accountId, String sourceType, String sourceId,
                           BigDecimal principal, int termMonths, BigDecimal monthlyFeeRate,
                           BigDecimal totalFee, BigDecimal remainingPrincipal, String status,
                           LocalDateTime createdAt, LocalDateTime settledAt,
                           List<ScheduleView> schedules, String warning) {
    }

    public record PlanPage(List<PlanView> items, int page, int size, long total) {
    }

    private final InstallmentPlanRepository planRepository;
    private final InstallmentScheduleRepository scheduleRepository;
    private final AccessGuard accessGuard;

    public InstallmentQueryService(InstallmentPlanRepository planRepository,
                                   InstallmentScheduleRepository scheduleRepository,
                                   AccessGuard accessGuard) {
        this.planRepository = planRepository;
        this.scheduleRepository = scheduleRepository;
        this.accessGuard = accessGuard;
    }

    @Transactional(readOnly = true)
    public PlanPage list(InstallmentPrincipal principal, String accountId, String status, int page, int size) {
        requirePaging(page, size);
        PlanStatus filter = parseStatus(status);
        accessGuard.requireReadAccess(principal, accountId);
        PageRequest request = PageRequest.of(page - 1, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<InstallmentPlan> result = filter == null
                ? planRepository.findByAccountId(accountId, request)
                : planRepository.findByAccountIdAndStatus(accountId, filter, request);
        return new PlanPage(result.getContent().stream().map(plan -> toView(plan, false)).toList(),
                page, size, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public PlanPage backOfficeList(InstallmentPrincipal principal, String accountId, String status,
                                   int page, int size) {
        requirePaging(page, size);
        PlanStatus filter = parseStatus(status);
        accessGuard.requireBackOfficeRead(principal);
        PageRequest request = PageRequest.of(page - 1, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<InstallmentPlan> result;
        if (accountId != null && filter != null) {
            result = planRepository.findByAccountIdAndStatus(accountId, filter, request);
        } else if (accountId != null) {
            result = planRepository.findByAccountId(accountId, request);
        } else if (filter != null) {
            result = planRepository.findByStatus(filter, request);
        } else {
            result = planRepository.findAll(request);
        }
        return new PlanPage(result.getContent().stream().map(plan -> toView(plan, false)).toList(),
                page, size, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public PlanView detail(InstallmentPrincipal principal, String planId) {
        InstallmentPlan plan = planRepository.findById(planId)
                .orElseThrow(() -> new NotFoundException("INSTALLMENT_NOT_FOUND", "Installment plan not found."));
        accessGuard.requireReadAccess(principal, plan.getAccountId());
        return toView(plan, true);
    }

    private PlanView toView(InstallmentPlan plan, boolean withSchedules) {
        List<InstallmentSchedule> schedules = withSchedules
                ? scheduleRepository.findByPlanIdOrderByInstallmentNo(plan.getPlanId())
                : List.of();
        String warning = withSchedules && schedules.isEmpty() ? "SCHEDULE_INCONSISTENT" : null;
        return new PlanView(plan.getPlanId(), plan.getAccountId(), plan.getSourceType().name(),
                plan.getSourceId(), plan.getPrincipal(), plan.getTermMonths(), plan.getMonthlyFeeRate(),
                plan.getTotalFee(), plan.getRemainingPrincipal(), plan.getStatus().name(),
                plan.getCreatedAt(), plan.getSettledAt(),
                schedules.stream()
                        .map(schedule -> new ScheduleView(schedule.getInstallmentNo(), schedule.getDueDate(),
                                schedule.getPrincipalDue(), schedule.getFeeDue(), schedule.getTotalDue(),
                                schedule.getStatus().name(), schedule.getPaidAt()))
                        .toList(),
                warning);
    }

    private static void requirePaging(int page, int size) {
        if (page < 1 || size < 1 || size > 100) {
            throw new BusinessRuleException("INVALID_PARAMETER", "page must be >= 1 and size between 1 and 100.");
        }
    }

    private static PlanStatus parseStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        try {
            return PlanStatus.valueOf(status);
        } catch (IllegalArgumentException ex) {
            throw new BusinessRuleException("INVALID_PARAMETER", "Unknown status filter: " + status);
        }
    }
}
