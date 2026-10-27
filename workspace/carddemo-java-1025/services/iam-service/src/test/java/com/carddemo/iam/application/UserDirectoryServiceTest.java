package com.carddemo.iam.application;

import com.carddemo.iam.domain.exception.BusinessRuleException;
import com.carddemo.iam.domain.exception.NotFoundException;
import com.carddemo.iam.domain.exception.ValidationException;
import com.carddemo.iam.domain.model.User;
import com.carddemo.iam.domain.model.UserDetails;
import com.carddemo.iam.domain.security.PasswordHasher;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用户目录用例：列表、新增、修改、删除与管理员保护规则。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class UserDirectoryServiceTest {

    @Autowired
    private UserDirectoryService userDirectoryService;

    @Autowired
    private PasswordHasher passwordHasher;

    @Test
    void listsSeededUsersSortedByUserId() {
        PageResult<User> page = userDirectoryService.list(0, 10);

        assertThat(page.items()).extracting(User::getUserId)
                .containsExactly("ADMIN001", "ADMIN002", "ADMIN003", "USER0001", "USER0002");
        assertThat(page.page()).isZero();
        assertThat(page.size()).isEqualTo(10);
        assertThat(page.total()).isEqualTo(5);
    }

    @Test
    void returns404ForUnknownUser() {
        assertThatThrownBy(() -> userDirectoryService.get("NOBODY01"))
                .isInstanceOf(NotFoundException.class)
                .extracting("code").isEqualTo("USER_NOT_FOUND");
    }

    @Test
    void createsUserWithUppercasedIdAndHashedPassword() {
        User created = userDirectoryService.create(" user0009 ",
                new UserDetails("Ada", "Lovelace", "U"), "pass1234");

        assertThat(created.getUserId()).isEqualTo("USER0009");
        assertThat(created.getUserType()).isEqualTo("U");
        assertThat(created.getPasswordHash()).startsWith("pbkdf2$210000$");
        assertThat(passwordHasher.verify("pass1234", created.getPasswordHash())).isTrue();
        assertThat(userDirectoryService.list(0, 10).total()).isEqualTo(6);
    }

    @Test
    void rejectsDuplicateUserId() {
        assertThatThrownBy(() -> userDirectoryService.create("admin001",
                new UserDetails("Other", "Admin", "A"), "pass1234"))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("USER_ALREADY_EXISTS");
    }

    @Test
    void rejectsUserTypeOutsideLegacyEnumeration() {
        assertThatThrownBy(() -> userDirectoryService.create("USER0003",
                new UserDetails("Ada", "Lovelace", "X"), "pass1234"))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("User Type must be A or U");
    }

    @Test
    void rejectsBlankFirstName() {
        assertThatThrownBy(() -> userDirectoryService.create("USER0004",
                new UserDetails("  ", "Lovelace", "U"), "pass1234"))
                .isInstanceOf(ValidationException.class)
                .extracting("details")
                .isEqualTo(List.of("firstName: First Name must be supplied."));
    }

    @Test
    void rejectsPasswordOutsideLegacyLengthRange() {
        assertThatThrownBy(() -> userDirectoryService.create("USER0005",
                new UserDetails("Ada", "Lovelace", "U"), "short"))
                .isInstanceOf(ValidationException.class)
                .hasMessage("Password must be 8 to 64 characters.");
    }

    @Test
    void refusesToDeleteLastAdministrator() {
        userDirectoryService.delete("ADMIN002", "ADMIN001");
        userDirectoryService.delete("ADMIN003", "ADMIN001");

        assertThatThrownBy(() -> userDirectoryService.delete("ADMIN001", "USER0001"))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("LAST_ADMIN");
    }

    @Test
    void refusesToDemoteLastAdministrator() {
        userDirectoryService.update("ADMIN002", new UserDetails("Staff", "Assistant", "U"), null);
        userDirectoryService.update("ADMIN003", new UserDetails("Risk", "ReadOnly", "U"), null);

        assertThatThrownBy(() -> userDirectoryService.update("ADMIN001",
                new UserDetails("System", "Administrator", "U"), null))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("LAST_ADMIN");
    }

    @Test
    void refusesToDeleteOwnRecord() {
        assertThatThrownBy(() -> userDirectoryService.delete("USER0001", " user0001 "))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("CANNOT_DELETE_SELF");
    }

    @Test
    void keepsPasswordWhenUpdateOmitsItAndReplacesItWhenSupplied() {
        User before = userDirectoryService.get("USER0001");
        String originalHash = before.getPasswordHash();

        User renamed = userDirectoryService.update("USER0001",
                new UserDetails("Demo", "Tester", "U"), null);

        assertThat(renamed.getLastName()).isEqualTo("Tester");
        assertThat(renamed.getPasswordHash()).isEqualTo(originalHash);

        User repasswored = userDirectoryService.update("USER0001",
                new UserDetails("Demo", "Tester", "U"), "newpass1");

        assertThat(repasswored.getPasswordHash()).isNotEqualTo(originalHash);
        assertThat(passwordHasher.verify("newpass1", repasswored.getPasswordHash())).isTrue();
    }

    @Test
    void deletesAdministratorOnceAnotherAdministratorExists() {
        userDirectoryService.update("USER0001", new UserDetails("Demo", "User", "A"), null);

        userDirectoryService.delete("ADMIN001", "USER0001");

        assertThatThrownBy(() -> userDirectoryService.get("ADMIN001"))
                .isInstanceOf(NotFoundException.class);
    }
}
