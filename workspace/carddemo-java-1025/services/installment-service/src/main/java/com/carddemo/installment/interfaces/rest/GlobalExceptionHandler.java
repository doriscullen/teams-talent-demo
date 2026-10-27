package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.domain.exception.BusinessRuleException;
import com.carddemo.installment.domain.exception.ExportExpiredException;
import com.carddemo.installment.domain.exception.ForbiddenException;
import com.carddemo.installment.domain.exception.NotFoundException;
import com.carddemo.installment.domain.exception.RemoteServiceException;
import com.carddemo.installment.domain.exception.UnauthorizedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.Set;

/** 统一错误码（PRD §7）：{code,message,details}，HTTP 语义 400/401/403/404/409/410/503。 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Set<String> BAD_REQUEST_CODES = Set.of(
            "INVALID_PARAMETER", "INVALID_TERM", "AGREEMENT_REQUIRED", "INVALID_FEE_REBATE",
            "REPAYMENT_EXCEEDS_PRINCIPAL");

    @ExceptionHandler(BusinessRuleException.class)
    public ResponseEntity<ApiError> handleBusinessRule(BusinessRuleException ex) {
        HttpStatus status = BAD_REQUEST_CODES.contains(ex.getCode())
                ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT;
        return ResponseEntity.status(status).body(new ApiError(ex.getCode(), ex.getMessage(), List.of()));
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ApiError(ex.getCode(), ex.getMessage(), List.of()));
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ApiError> handleUnauthorized(UnauthorizedException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ApiError("UNAUTHENTICATED", ex.getMessage(), List.of()));
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ApiError> handleForbidden(ForbiddenException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ApiError("FORBIDDEN", ex.getMessage(), List.of()));
    }

    @ExceptionHandler(ExportExpiredException.class)
    public ResponseEntity<ApiError> handleExportExpired(ExportExpiredException ex) {
        return ResponseEntity.status(HttpStatus.GONE)
                .body(new ApiError("EXPORT_EXPIRED", ex.getMessage(), List.of()));
    }

    @ExceptionHandler(RemoteServiceException.class)
    public ResponseEntity<ApiError> handleRemote(RemoteServiceException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiError("DOWNSTREAM_UNAVAILABLE", ex.getMessage(), List.of(ex.getTarget())));
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError("CONCURRENT_MODIFICATION",
                "Installment state changed concurrently, please refresh and retry.", List.of()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            IllegalArgumentException.class})
    public ResponseEntity<ApiError> handleValidation(Exception ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiError("INVALID_PARAMETER", "Request payload is not valid.", List.of()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiError("INTERNAL_ERROR", "Unexpected error.", List.of()));
    }
}
