package com.carddemo.installment.domain.exception;

/** 认证失败（无 token / 签名非法 / 过期）：401。 */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
