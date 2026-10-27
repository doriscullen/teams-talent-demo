package com.carddemo.installment.domain.exception;

/** 已认证但无权限（如只读风控请求写接口）：403。 */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
