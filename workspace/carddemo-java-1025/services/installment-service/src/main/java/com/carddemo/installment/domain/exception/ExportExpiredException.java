package com.carddemo.installment.domain.exception;

/** 导出文件超过 24 小时有效期：410。 */
public class ExportExpiredException extends RuntimeException {

    public ExportExpiredException(String message) {
        super(message);
    }
}
