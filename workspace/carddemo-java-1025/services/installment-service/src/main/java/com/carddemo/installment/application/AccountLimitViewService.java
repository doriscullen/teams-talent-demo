package com.carddemo.installment.application;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.AuditPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.domain.repository.AccountLimitViewRepository;
import com.carddemo.installment.infrastructure.security.AccessGuard;
import com.carddemo.installment.infrastructure.security.InstallmentPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 账户额度视图查询（原文 §8.1 {@code account_limit_view}、US-004、§11.2）：
 * 账户额度字段由 account-service 提供，{@code installment_occupied} 由 V7 视图从
 * {@code installment_plan} 聚合（ACTIVE 计划剩余本金合计，本金口径）。
 * 本查询只读，不改变余额/可用额度，也不做任何释放（BR-INS-10）。
 */
@Service
public class AccountLimitViewService {

    public record LimitView(String accountId, String activeStatus, BigDecimal creditLimit,
                            BigDecimal cashCreditLimit, BigDecimal currentBalance,
                            BigDecimal installmentOccupied, long activePlanCount, LocalDateTime asOf) {
    }

    private final AccountLimitViewRepository viewRepository;
    private final AccountPort accountPort;
    private final AccessGuard accessGuard;
    private final AuditPort auditPort;
    private final ClockProvider clock;

    public AccountLimitViewService(AccountLimitViewRepository viewRepository,
                                   AccountPort accountPort,
                                   AccessGuard accessGuard,
                                   AuditPort auditPort,
                                   ClockProvider clock) {
        this.viewRepository = viewRepository;
        this.accountPort = accountPort;
        this.accessGuard = accessGuard;
        this.auditPort = auditPort;
        this.clock = clock;
    }

    /** 持卡人限本人账户（越权 404）；后台读取需权限点并留痕（C-07）。 */
    @Transactional
    public LimitView accountLimitView(InstallmentPrincipal principal, String accountId) {
        accessGuard.requireReadAccess(principal, accountId);
        AccountPort.AccountSnapshot account = accountPort.getAccount(accountId);
        AccountLimitViewRepository.Occupancy occupancy = viewRepository.findOccupancy(accountId);
        LocalDateTime asOf = clock.now();
        if (principal.isBackOffice()) {
            auditPort.record(principal.userId(), "INSTALLMENT_LIMIT_VIEWED", "ACCOUNT", accountId,
                    "installmentOccupied=" + occupancy.installmentOccupied()
                            + ",activePlanCount=" + occupancy.activePlanCount() + ",at=" + asOf);
        }
        return new LimitView(account.accountId(), account.activeStatus(), account.creditLimit(),
                account.cashCreditLimit(), account.currentBalance(),
                occupancy.installmentOccupied(), occupancy.activePlanCount(), asOf);
    }
}
