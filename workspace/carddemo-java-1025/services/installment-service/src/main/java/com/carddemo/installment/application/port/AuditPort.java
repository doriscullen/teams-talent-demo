package com.carddemo.installment.application.port;

/** 审计端口（§6.1/§8.2）。写失败不得回滚业务，应进入本地补偿队列。 */
public interface AuditPort {

    void record(String actor, String action, String resourceType, String resourceId, String payload);
}
