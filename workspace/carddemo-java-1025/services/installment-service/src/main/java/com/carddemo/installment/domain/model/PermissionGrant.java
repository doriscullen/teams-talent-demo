package com.carddemo.installment.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

/**
 * 后台权限点（AC-21）：STAFF_ASSIST 可协助写；RISK_READONLY 严格只读。
 * 不得仅凭 userType=A 放行写操作。
 */
@Entity
@Table(name = "installment_permission")
@IdClass(PermissionGrant.Key.class)
public class PermissionGrant {

    public static final String STAFF_ASSIST = "STAFF_ASSIST";
    public static final String RISK_READONLY = "RISK_READONLY";

    @Id
    @Column(name = "user_id", length = 8, nullable = false)
    private String userId;

    @Id
    @Column(name = "permission", length = 32, nullable = false)
    private String permission;

    protected PermissionGrant() {
        // for JPA
    }

    public String getUserId() {
        return userId;
    }

    public String getPermission() {
        return permission;
    }

    /** 复合主键。 */
    public static class Key implements java.io.Serializable {

        private String userId;
        private String permission;

        public Key() {
            // for JPA
        }

        public Key(String userId, String permission) {
            this.userId = userId;
            this.permission = permission;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Key key)) {
                return false;
            }
            return java.util.Objects.equals(userId, key.userId)
                    && java.util.Objects.equals(permission, key.permission);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(userId, permission);
        }
    }
}
