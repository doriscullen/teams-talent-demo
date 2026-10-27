package com.carddemo.installment.infrastructure.security;

import com.carddemo.installment.domain.exception.ForbiddenException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.model.PermissionGrant;
import com.carddemo.installment.domain.repository.AccountAccessRepository;
import com.carddemo.installment.domain.repository.PermissionGrantRepository;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** BR-INS-13 / AC-21：客户归属 404；客服可写、风控只读 403，不得仅凭 userType=A 放行。 */
class AccessGuardTest {

    private final AccountAccessRepository accessRepository = mock(AccountAccessRepository.class);
    private final PermissionGrantRepository permissionRepository = mock(PermissionGrantRepository.class);
    private final AccessGuard guard = new AccessGuard(accessRepository, permissionRepository);

    private static final InstallmentPrincipal CUSTOMER = new InstallmentPrincipal("USER0001", "U");
    private static final InstallmentPrincipal STAFF = new InstallmentPrincipal("ADMIN002", "A");
    private static final InstallmentPrincipal RISK = new InstallmentPrincipal("ADMIN003", "A");
    private static final InstallmentPrincipal PLAIN_ADMIN = new InstallmentPrincipal("ADMIN009", "A");

    @Test
    void customerCanWriteOwnAccountOnly() {
        when(accessRepository.existsByAccountIdAndUserId("00000000006", "USER0001")).thenReturn(true);
        assertThatCode(() -> guard.requireWriteAccess(CUSTOMER, "00000000006")).doesNotThrowAnyException();
        assertThatThrownBy(() -> guard.requireWriteAccess(CUSTOMER, "00000000005"))
                .isInstanceOf(NotFoundException.class)
                .extracting(ex -> ((NotFoundException) ex).getCode())
                .isEqualTo("INSTALLMENT_NOT_FOUND");
    }

    @Test
    void staffCanAssistButRiskCannotWrite() {
        when(permissionRepository.existsByUserIdAndPermission("ADMIN002", PermissionGrant.STAFF_ASSIST))
                .thenReturn(true);
        when(permissionRepository.existsByUserIdAndPermission("ADMIN003", PermissionGrant.RISK_READONLY))
                .thenReturn(true);
        when(permissionRepository.existsByUserIdAndPermission("ADMIN003", PermissionGrant.STAFF_ASSIST))
                .thenReturn(false);

        assertThat(guard.canAssistWrite(STAFF)).isTrue();
        assertThatCode(() -> guard.requireWriteAccess(STAFF, "00000000006")).doesNotThrowAnyException();

        assertThat(guard.canReadAny(RISK)).isTrue();
        assertThat(guard.canAssistWrite(RISK)).isFalse();
        assertThatThrownBy(() -> guard.requireWriteAccess(RISK, "00000000006"))
                .isInstanceOf(ForbiddenException.class);
        assertThatCode(() -> guard.requireBackOfficeRead(RISK)).doesNotThrowAnyException();
    }

    @Test
    void backOfficeWithoutPermissionIsForbidden() {
        assertThatThrownBy(() -> guard.requireWriteAccess(PLAIN_ADMIN, "00000000006"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> guard.requireBackOfficeRead(PLAIN_ADMIN))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    void customerCannotUseBackOfficeEndpoints() {
        assertThatThrownBy(() -> guard.requireBackOfficeRead(CUSTOMER))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    void customerMayReadOwnAccount() {
        when(accessRepository.existsByAccountIdAndUserId("00000000006", "USER0001")).thenReturn(true);
        assertThatCode(() -> guard.requireReadAccess(CUSTOMER, "00000000006")).doesNotThrowAnyException();
    }
}
