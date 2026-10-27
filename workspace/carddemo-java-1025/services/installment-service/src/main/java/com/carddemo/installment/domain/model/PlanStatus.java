package com.carddemo.installment.domain.model;

/** 计划状态机（PRD §14）：ACTIVE → SETTLED / CANCELLED，禁止跳态。 */
public enum PlanStatus {
    ACTIVE,
    SETTLED,
    CANCELLED
}
