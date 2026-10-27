package com.carddemo.installment.infrastructure.security;

/** 请求主体：来自真实 IAM token，绝不从请求体或自定义头读取（AC-14/AC-21）。 */
public record InstallmentPrincipal(String userId, String userType) {

    public static final String ATTRIBUTE = "installmentPrincipal";

    public boolean isBackOffice() {
        return "A".equals(userType);
    }
}
