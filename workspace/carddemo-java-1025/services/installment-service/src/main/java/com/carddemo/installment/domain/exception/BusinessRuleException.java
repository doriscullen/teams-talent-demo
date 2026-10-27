package com.carddemo.installment.domain.exception;

/** 业务规则失败：携带统一错误码（PRD §7）。 */
public class BusinessRuleException extends RuntimeException {

    private final String code;

    public BusinessRuleException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
