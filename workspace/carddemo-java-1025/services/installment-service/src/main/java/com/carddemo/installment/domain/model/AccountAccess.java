package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

/** 持卡人—账户归属（AC-15）：账户归属来自服务端数据，不信任请求体。 */
@Entity
@Table(name = "installment_account_access")
@IdClass(AccountAccess.Key.class)
public class AccountAccess {

    @Id
    @Column(name = "account_id", length = 11, nullable = false)
    private String accountId;

    @Id
    @Column(name = "user_id", length = 8, nullable = false)
    private String userId;

    protected AccountAccess() {
        // for JPA
    }

    public String getAccountId() {
        return accountId;
    }

    public String getUserId() {
        return userId;
    }

    /** 复合主键。 */
    public static class Key implements java.io.Serializable {

        private String accountId;
        private String userId;

        public Key() {
            // for JPA
        }

        public Key(String accountId, String userId) {
            this.accountId = accountId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Key key)) {
                return false;
            }
            return java.util.Objects.equals(accountId, key.accountId)
                    && java.util.Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(accountId, userId);
        }
    }
}
