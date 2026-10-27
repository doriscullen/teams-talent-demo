package com.carddemo.ledger.interfaces.rest;

import com.carddemo.ledger.application.LedgerPostingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

/** 总账分录接口（供分期服务过账；本地演示不对外暴露公网）。 */
@RestController
@RequestMapping("/api/v1/journal-entries")
@Tag(name = "总账", description = "分期手续费/违约金/减免分录，按 entryGroupId 幂等")
public class JournalEntryController {

    public record JournalLineRequest(
            @NotBlank @Size(max = 40) String accountCode,
            @NotBlank @Pattern(regexp = "DEBIT|CREDIT") String direction,
            @NotNull @DecimalMin(value = "0.00") BigDecimal amount,
            @Size(max = 120) String memo) {
    }

    public record JournalEntryRequest(
            @NotBlank @Size(max = 64) String entryGroupId,
            @NotBlank @Size(max = 40) String businessType,
            @NotBlank @Size(max = 64) String referenceId,
            @NotEmpty @Valid List<JournalLineRequest> lines) {
    }

    public record JournalEntryResponse(String entryGroupId, int lineCount, boolean duplicate) {
    }

    private final LedgerPostingService postingService;

    public JournalEntryController(LedgerPostingService postingService) {
        this.postingService = postingService;
    }

    @Operation(summary = "过账分录组", description = "同一 entryGroupId 重复提交返回 duplicate=true，不产生第二组分录。")
    @PostMapping
    public ResponseEntity<JournalEntryResponse> post(@Valid @RequestBody JournalEntryRequest request) {
        LedgerPostingService.PostingResult result = postingService.post(new LedgerPostingService.PostingCommand(
                request.entryGroupId(), request.businessType(), request.referenceId(),
                request.lines().stream()
                        .map(line -> new LedgerPostingService.JournalLine(line.accountCode(), line.direction(),
                                line.amount(), line.memo()))
                        .toList()));
        return ResponseEntity.status(result.duplicate() ? HttpStatus.OK : HttpStatus.CREATED)
                .body(new JournalEntryResponse(result.entryGroupId(), result.lineCount(), result.duplicate()));
    }

    @Operation(summary = "查询分录组明细")
    @GetMapping("/{entryGroupId}")
    public List<EntryLineResponse> lines(@PathVariable String entryGroupId) {
        return postingService.lines(entryGroupId).stream()
                .map(line -> new EntryLineResponse(line.getAccountCode(), line.getDirection(), line.getAmount(),
                        line.getMemo()))
                .toList();
    }

    public record EntryLineResponse(String accountCode, String direction, BigDecimal amount, String memo) {
    }
}
