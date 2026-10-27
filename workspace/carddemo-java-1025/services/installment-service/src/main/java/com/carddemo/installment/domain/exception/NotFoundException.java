package com.carddemo.installment.domain.exception;

/** 不存在或越权：对外统一 404，不泄露存在性。 */
public class NotFoundException extends RuntimeException {

    private final String code;

    public NotFoundException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
