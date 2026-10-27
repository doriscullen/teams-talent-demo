package com.carddemo.installment.infrastructure.security;

import com.carddemo.installment.domain.exception.ForbiddenException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.PermissionGrant;
import com.carddemo.installment.domain.repository.AccountAccessRepository;
import com.carddemo.installment.domain.repository.PermissionGrantRepository;
import org.springframework.stereotype.Component;

/**
 * 授权规则（BR-INS-13、AC-21）：
 * <ul>
 *   <li>持卡人（U）只能操作归属账户，越权一律 404；</li>
 *   <li>后台（A）必须再区分：STAFF_ASSIST 可协助写，RISK_READONLY 严格只读；</li>
 *   <li>仅有 userType=A 而没有权限点 → 403，不能因此放行写操作。</li>
 * </ul>
 */
@Component
public class AccessGuard {

    private final AccountAccessRepository accountAccessRepository;
    private final PermissionGrantRepository permissionGrantRepository;

    public AccessGuard(AccountAccessRepository accountAccessRepository,
                       PermissionGrantRepository permissionGrantRepository) {
        this.accountAccessRepository = accountAccessRepository;
        this.permissionGrantRepository = permissionGrantRepository;
    }

    public boolean canAssistWrite(InstallmentPrincipal principal) {
        return principal.isBackOffice()
                && permissionGrantRepository.existsByUserIdAndPermission(
                        principal.userId(), PermissionGrant.STAFF_ASSIST);
    }

    public boolean canReadAny(InstallmentPrincipal principal) {
        return principal.isBackOffice()
                && (permissionGrantRepository.existsByUserIdAndPermission(
                        principal.userId(), PermissionGrant.STAFF_ASSIST)
                || permissionGrantRepository.existsByUserIdAndPermission(
                        principal.userId(), PermissionGrant.RISK_READONLY));
    }

    /** 写操作（创建/结清）：本人客户，或具备 STAFF_ASSIST 的客服。 */
    public void requireWriteAccess(InstallmentPrincipal principal, String accountId) {
        if (principal.isBackOffice()) {
            if (!canAssistWrite(principal)) {
                throw new ForbiddenException("Back-office user has no write permission for installments.");
            }
            return;
        }
        requireOwnership(principal, accountId);
    }

    /** 读操作（列表/详情）：本人客户，或任一后台权限点（含只读风控）。 */
    public void requireReadAccess(InstallmentPrincipal principal, String accountId) {
        if (principal.isBackOffice()) {
            if (!canReadAny(principal)) {
                throw new ForbiddenException("Back-office user has no read permission for installments.");
            }
            return;
        }
        requireOwnership(principal, accountId);
    }

    /** 后台查询/导出：必须 A 且具备任一后台权限点。 */
    public void requireBackOfficeRead(InstallmentPrincipal principal) {
        if (!canReadAny(principal)) {
            throw new ForbiddenException("Back-office read permission is required.");
        }
    }

    private void requireOwnership(InstallmentPrincipal principal, String accountId) {
        if (!accountAccessRepository.existsByAccountIdAndUserId(accountId, principal.userId())) {
            throw new NotFoundException("INSTALLMENT_NOT_FOUND", "Account is not accessible for this customer.");
        }
    }
}
