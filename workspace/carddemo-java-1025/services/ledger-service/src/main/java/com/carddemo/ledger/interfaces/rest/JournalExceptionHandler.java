package com.carddemo.ledger.interfaces.rest;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/** 分录输入错误（不平衡/金额非正/同组内容冲突）返回 400，不落库。 */
@RestControllerAdvice
public class JournalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("code", "INVALID_JOURNAL_ENTRY", "message", String.valueOf(ex.getMessage())));
    }
}
