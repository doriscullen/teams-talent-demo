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

/** ADR-010：同一 entryGroupId 幂等，重复提交不产生第二组分录（US-002/US-007 的资金幂等基础）。 */
class LedgerPostingServiceTest {

    private EntryGroupRepository groupRepository;
    private EntryLineRepository lineRepository;
    private LedgerPostingService service;

    @BeforeEach
    void setUp() {
        groupRepository = mock(EntryGroupRepository.class);
        lineRepository = mock(EntryLineRepository.class);
        service = new LedgerPostingService(groupRepository, lineRepository);
    }

    private LedgerPostingService.PostingCommand command() {
        return new LedgerPostingService.PostingCommand("IP0001", "INSTALLMENT_CREATE", "IP0001",
                List.of(new LedgerPostingService.JournalLine("1100-RECEIVABLE", "DEBIT",
                                new BigDecimal("1000.00"), "principal"),
                        new LedgerPostingService.JournalLine("4001-FEE-INCOME", "CREDIT",
                                new BigDecimal("19.25"), "fee")));
    }

    @Test
    void firstPostingStoresGroupAndLines() {
        when(groupRepository.findById("IP0001")).thenReturn(Optional.empty());
        when(groupRepository.save(any(EntryGroup.class))).thenAnswer(invocation -> invocation.getArgument(0));

        LedgerPostingService.PostingResult result = service.post(command());

        assertThat(result.duplicate()).isFalse();
        assertThat(result.lineCount()).isEqualTo(2);
        verify(lineRepository, org.mockito.Mockito.times(2)).save(any(EntryLine.class));
    }

    @Test
    void replayReturnsDuplicateWithoutSecondJournal() {
        EntryGroup existing = new EntryGroup("IP0001", "INSTALLMENT_CREATE", "IP0001", 2, LocalDateTime.now());
        when(groupRepository.findById("IP0001")).thenReturn(Optional.of(existing));

        LedgerPostingService.PostingResult result = service.post(command());

        assertThat(result.duplicate()).isTrue();
        verify(groupRepository, never()).save(any());
        verify(lineRepository, never()).save(any());
    }

    @Test
    void emptyLinesAreRejected() {
        assertThatThrownBy(() -> service.post(new LedgerPostingService.PostingCommand("IP1", "T", "R", List.of())))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
