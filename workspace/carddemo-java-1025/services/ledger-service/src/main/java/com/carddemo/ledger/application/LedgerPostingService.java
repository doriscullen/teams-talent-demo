package com.carddemo.ledger.application;

import com.carddemo.ledger.domain.model.EntryGroup;
import com.carddemo.ledger.domain.model.EntryLine;
import com.carddemo.ledger.domain.repository.EntryGroupRepository;
import com.carddemo.ledger.domain.repository.EntryLineRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 过账用例：按 entryGroupId 幂等，同一分组重复提交只保存一组分录并返回 duplicate=true。
 */
@Service
public class LedgerPostingService {

    public record JournalLine(String accountCode, String direction, BigDecimal amount, String memo) {
    }

    public record PostingCommand(String entryGroupId, String businessType, String referenceId,
                                 List<JournalLine> lines) {
    }

    public record PostingResult(String entryGroupId, int lineCount, boolean duplicate) {
    }

    private final EntryGroupRepository groupRepository;
    private final EntryLineRepository lineRepository;

    public LedgerPostingService(EntryGroupRepository groupRepository, EntryLineRepository lineRepository) {
        this.groupRepository = groupRepository;
        this.lineRepository = lineRepository;
    }

    @Transactional
    public PostingResult post(PostingCommand command) {
        if (command.lines() == null || command.lines().isEmpty()) {
            throw new IllegalArgumentException("At least one journal line is required");
        }
        EntryGroup existing = groupRepository.findById(command.entryGroupId()).orElse(null);
        if (existing != null) {
            return new PostingResult(existing.getEntryGroupId(), existing.getLineCount(), true);
        }
        EntryGroup group = groupRepository.save(new EntryGroup(command.entryGroupId(), command.businessType(),
                command.referenceId(), command.lines().size(), LocalDateTime.now()));
        for (JournalLine line : command.lines()) {
            lineRepository.save(new EntryLine(group.getEntryGroupId(), line.accountCode(), line.direction(),
                    line.amount(), line.memo()));
        }
        return new PostingResult(group.getEntryGroupId(), group.getLineCount(), false);
    }

    @Transactional(readOnly = true)
    public List<EntryLine> lines(String entryGroupId) {
        return lineRepository.findByEntryGroupId(entryGroupId);
    }
}
