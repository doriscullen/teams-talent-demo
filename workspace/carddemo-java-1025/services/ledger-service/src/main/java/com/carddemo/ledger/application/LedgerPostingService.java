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
 * 过账用例（A-006）：
 * <ul>
 *   <li>每组分录必须借贷平衡（ΣDEBIT = ΣCREDIT）且每行金额为正，否则拒收；</li>
 *   <li>按 entryGroupId 幂等：同一分组重复提交只保存一组分录并返回 duplicate=true；</li>
 *   <li>同一 entryGroupId 携带不同分录内容属于冲突，不静默覆盖也不追加第二组。</li>
 * </ul>
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

    private static final String DEBIT = "DEBIT";
    private static final String CREDIT = "CREDIT";

    private final EntryGroupRepository groupRepository;
    private final EntryLineRepository lineRepository;
    private final JournalGroupLock groupLock;

    public LedgerPostingService(EntryGroupRepository groupRepository, EntryLineRepository lineRepository,
                                JournalGroupLock groupLock) {
        this.groupRepository = groupRepository;
        this.lineRepository = lineRepository;
        this.groupLock = groupLock;
    }

    @Transactional
    public PostingResult post(PostingCommand command) {
        requireBalanced(command.lines());

        // 同一分组的并发请求串行化：第二个请求在锁释放后看到已提交分组，按幂等返回
        groupLock.acquire(command.entryGroupId());
        EntryGroup existing = groupRepository.findById(command.entryGroupId()).orElse(null);
        if (existing != null) {
            if (!sameContent(existing.getEntryGroupId(), command.lines())) {
                throw new IllegalArgumentException(
                        "entryGroupId " + command.entryGroupId() + " was posted with different journal lines");
            }
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
        return lineRepository.findByEntryGroupIdOrderByLineIdAsc(entryGroupId);
    }

    static void requireBalanced(List<JournalLine> lines) {
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("At least one journal line is required");
        }
        BigDecimal debit = BigDecimal.ZERO;
        BigDecimal credit = BigDecimal.ZERO;
        for (JournalLine line : lines) {
            if (line.accountCode() == null || line.accountCode().isBlank()) {
                throw new IllegalArgumentException("Journal line accountCode is required");
            }
            if (line.amount() == null || line.amount().signum() <= 0) {
                throw new IllegalArgumentException("Journal line amount must be greater than zero");
            }
            if (DEBIT.equals(line.direction())) {
                debit = debit.add(line.amount());
            } else if (CREDIT.equals(line.direction())) {
                credit = credit.add(line.amount());
            } else {
                throw new IllegalArgumentException("Journal line direction must be DEBIT or CREDIT");
            }
        }
        if (debit.compareTo(credit) != 0) {
            throw new IllegalArgumentException(
                    "Journal group is not balanced: debit=" + debit + ", credit=" + credit);
        }
    }

    private boolean sameContent(String entryGroupId, List<JournalLine> lines) {
        List<EntryLine> stored = lineRepository.findByEntryGroupIdOrderByLineIdAsc(entryGroupId);
        if (stored.size() != lines.size()) {
            return false;
        }
        for (int index = 0; index < lines.size(); index++) {
            EntryLine line = stored.get(index);
            JournalLine candidate = lines.get(index);
            if (!line.getAccountCode().equals(candidate.accountCode())
                    || !line.getDirection().equals(candidate.direction())
                    || line.getAmount().compareTo(candidate.amount()) != 0) {
                return false;
            }
        }
        return true;
    }
}
