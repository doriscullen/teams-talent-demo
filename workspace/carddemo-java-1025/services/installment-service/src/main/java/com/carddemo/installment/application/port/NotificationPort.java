package com.carddemo.installment.application.port;

/** 通知端口（A-05）：通知失败不回滚分期主流程，落发件箱待补发。 */
public interface NotificationPort {

    void enqueue(String channel, String recipient, String template, String payload);
}
