package com.carddemo.installment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 分期上下文服务（ADR-010）：REQ-2026-001 账单/消费分期。 */
@SpringBootApplication
@EnableScheduling
public class InstallmentServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(InstallmentServiceApplication.class, args);
    }
}
