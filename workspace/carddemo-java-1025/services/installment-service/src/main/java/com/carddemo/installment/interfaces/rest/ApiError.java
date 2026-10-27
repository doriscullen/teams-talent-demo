package com.carddemo.installment.interfaces.rest;

import java.util.List;

/** 统一错误响应体（docs/design/07-java-conventions.md §4）。 */
public record ApiError(String code, String message, List<String> details) {
}
