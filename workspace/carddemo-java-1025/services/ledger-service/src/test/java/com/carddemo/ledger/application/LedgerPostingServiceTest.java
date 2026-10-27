package com.carddemo.ledger.application;

import com.carddemo.ledger.domain.model.EntryGroup;
import com.carddemo.ledger.domain.model.EntryLine;
import com.carddemo.ledger.domain.repository.EntryGroupRepository;
import com.carddemo.ledger.domain.repository.EntryLineRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** ADR-010 / A-006：借贷必须平衡，同一 entryGroupId 幂等，重复提交不产生第二组分录。 */
class LedgerPostingServiceTest {

    private EntryGroupRepository groupRepository;
    private EntryLineRepository lineRepository;
    private LedgerPostingService service;

    @BeforeEach
    void setUp() {
        groupRepository = mock(EntryGroupRepository.class);
        lineRepository = mock(EntryLineRepository.class);
        service = new LedgerPostingService(groupRepository, lineRepository, mock(JournalGroupLock.class));
    }

    private LedgerPostingService.PostingCommand command() {
        return new LedgerPostingService.PostingCommand("IP0001", "INSTALLMENT_CREATE", "IP0001",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "DEBIT",
                                new BigDecimal("1019.25"), "principal+fee"),
                        new LedgerPostingService.JournalLine("2100-CARDHOLDER-PAYABLE", "CREDIT",
                                new BigDecimal("1000.00"), "principal"),
                        new LedgerPostingService.JournalLine("4001-FEE-INCOME", "CREDIT",
                                new BigDecimal("19.25"), "fee")));
    }

    private List<EntryLine> storedLines() {
        return List.of(
                new EntryLine("IP0001", "1100-RECEIVABLE", "DEBIT", new BigDecimal("1019.25"), "principal+fee"),
                new EntryLine("IP0001", "2100-CARDHOLDER-PAYABLE", "CREDIT", new BigDecimal("1000.00"), "principal"),
                new EntryLine("IP0001", "4001-FEE-INCOME", "CREDIT", new BigDecimal("19.25"), "fee"));
    }

    @Test
    void firstPostingStoresBalancedGroupAndLines() {
        when(groupRepository.findById("IP0001")).thenReturn(Optional.empty());
        when(groupRepository.save(any(EntryGroup.class))).thenAnswer(invocation -> invocation.getArgument(0));

        LedgerPostingService.PostingResult result = service.post(command());

        assertThat(result.duplicate()).isFalse();
        assertThat(result.lineCount()).isEqualTo(3);
        verify(lineRepository, org.mockito.Mockito.times(3)).save(any(EntryLine.class));
    }

    @Test
    void replayReturnsDuplicateWithoutSecondJournal() {
        EntryGroup existing = new EntryGroup("IP0001", "INSTALLMENT_CREATE", "IP0001", 3, LocalDateTime.now());
        when(groupRepository.findById("IP0001")).thenReturn(Optional.of(existing));
        when(lineRepository.findByEntryGroupIdOrderByLineIdAsc("IP0001")).thenReturn(storedLines());

        LedgerPostingService.PostingResult result = service.post(command());

        assertThat(result.duplicate()).isTrue();
        verify(groupRepository, never()).save(any());
        verify(lineRepository, never()).save(any());
    }

    @Test
    void sameGroupWithDifferentLinesIsRejected() {
        EntryGroup existing = new EntryGroup("IP0001", "INSTALLMENT_CREATE", "IP0001", 3, LocalDateTime.now());
        when(groupRepository.findById("IP0001")).thenReturn(Optional.of(existing));
        when(lineRepository.findByEntryGroupIdOrderByLineIdAsc("IP0001")).thenReturn(storedLines());

        LedgerPostingService.PostingCommand tampered = new LedgerPostingService.PostingCommand("IP0001",
                "INSTALLMENT_CREATE", "IP0001",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "DEBIT",
                                new BigDecimal("9999.00"), "principal+fee"),
                        new LedgerPostingService.JournalLine("2100-CARDHOLDER-PAYABLE", "CREDIT",
                                new BigDecimal("9999.00"), "principal")));

        assertThatThrownBy(() -> service.post(tampered)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("different journal lines");
        verify(lineRepository, never()).save(any());
    }

    @Test
    void emptyLinesAreRejected() {
        assertThatThrownBy(() -> service.post(new LedgerPostingService.PostingCommand("IP1", "T", "R", List.of())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void unbalancedGroupIsRejected() {
        LedgerPostingService.PostingCommand unbalanced = new LedgerPostingService.PostingCommand("IP2",
                "INSTALLMENT_SETTLEMENT", "IP2",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "CREDIT",
                        new BigDecimal("600.00"), "settlement principal")));

        assertThatThrownBy(() -> service.post(unbalanced)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not balanced");
        verify(groupRepository, never()).save(any());
    }

    @Test
    void nonPositiveAmountAndUnknownDirectionAreRejected() {
        assertThatThrownBy(() -> service.post(new LedgerPostingService.PostingCommand("IP3", "T", "R",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "DEBIT", BigDecimal.ZERO, "zero"),
                        new LedgerPostingService.JournalLine("1100-RECEIVABLE", "CREDIT", BigDecimal.ZERO, "zero")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");

        assertThatThrownBy(() -> service.post(new LedgerPostingService.PostingCommand("IP4", "T", "R",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "DEBIT", new BigDecimal("1.00"), "x"),
                        new LedgerPostingService.JournalLine("1100-RECEIVABLE", "BOTH", new BigDecimal("1.00"), "x")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("DEBIT or CREDIT");
    }
}
