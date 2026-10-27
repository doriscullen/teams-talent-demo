package com.carddemo.installment.domain.exception;

/** 下游不可用（account / transaction / ledger）：503，主流程回滚。 */
public class RemoteServiceException extends RuntimeException {

    private final String target;

    public RemoteServiceException(String target, String message, Throwable cause) {
        super(message, cause);
        this.target = target;
    }

    public RemoteServiceException(String target, String message) {
        this(target, message, null);
    }

    public String getTarget() {
        return target;
    }
}
