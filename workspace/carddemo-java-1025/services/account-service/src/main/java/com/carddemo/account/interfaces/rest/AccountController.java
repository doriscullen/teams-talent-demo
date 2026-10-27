package com.carddemo.account.interfaces.rest;

import com.carddemo.account.application.AccountApplicationService;
import com.carddemo.account.domain.model.Account;
import com.carddemo.account.interfaces.rest.dto.AccountResponse;
import com.carddemo.account.interfaces.rest.dto.AmountRequest;
import com.carddemo.account.interfaces.rest.dto.CashbackCreditRequest;
import com.carddemo.account.interfaces.rest.dto.PaymentRequest;
import com.carddemo.account.interfaces.rest.dto.PostingRequest;
import com.carddemo.account.interfaces.rest.dto.UpdateAccountRequest;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/accounts")
public class AccountController {

    private final AccountApplicationService accountService;

    public AccountController(AccountApplicationService accountService) {
        this.accountService = accountService;
    }

    @GetMapping
    public Map<String, List<AccountResponse>> list() {
        List<AccountResponse> items = accountService.findAll().stream()
                .map(AccountResponse::from)
                .toList();
        return Map.of("items", items);
    }

    @GetMapping("/{accountId}")
    public AccountResponse get(@PathVariable String accountId) {
        return AccountResponse.from(accountService.getById(accountId));
    }

    @PutMapping("/{accountId}")
    public AccountResponse update(@PathVariable String accountId,
                                  @Valid @RequestBody UpdateAccountRequest request) {
        Account account = accountService.update(accountId, request.toDetails());
        return AccountResponse.from(account);
    }

    @PostMapping("/{accountId}/postings")
    public AccountResponse post(@PathVariable String accountId,
                                @Valid @RequestBody PostingRequest request) {
        return AccountResponse.from(accountService.applyPosting(accountId, request.amount()));
    }

    @PostMapping("/{accountId}/payments")
    public AccountResponse pay(@PathVariable String accountId,
                               @Valid @RequestBody PaymentRequest request) {
        return AccountResponse.from(accountService.applyIdempotentPayment(accountId, request.amount(),
                request.effectId()));
    }

    @PostMapping("/{accountId}/interest-accruals")
    public ResponseEntity<AccountResponse> accrueInterest(@PathVariable String accountId,
                                                          @Valid @RequestBody AmountRequest request) {
        return ResponseEntity.ok(AccountResponse.from(
                accountService.accrueInterest(accountId, request.amount())));
    }

    @Operation(summary = "营销返现入账", description = "按 rewardId 幂等冲减欠款；余额可为负表示溢缴")
    @PostMapping("/{accountId}/cashback-credits")
    public ResponseEntity<AccountResponse> creditCashback(@PathVariable String accountId,
                                                          @Valid @RequestBody CashbackCreditRequest request) {
        return ResponseEntity.ok(AccountResponse.from(accountService.creditCashback(accountId,
                request.rewardId(), request.campaignId(), request.amount())));
    }
}
