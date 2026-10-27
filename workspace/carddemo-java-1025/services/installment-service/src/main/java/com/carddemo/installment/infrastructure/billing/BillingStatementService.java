package com.carddemo.installment.infrastructure.billing;

import com.carddemo.installment.application.port.AccountPort;
import com.carddemo.installment.application.port.BillingPort;
import com.carddemo.installment.application.port.ClockProvider;
import com.carddemo.installment.application.port.TransactionPort;
import com.carddemo.installment.domain.model.EligibilityFlag;
import com.carddemo.installment.domain.model.PrincipalAllocation;
import com.carddemo.installment.domain.repository.EligibilityFlagRepository;
import com.carddemo.installment.domain.repository.PrincipalAllocationRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 最小账单能力（ADR-011）：账期以账户开卡日（openDate）为锚点，取本账期内的已入账消费交易；
 * 可分期本金 = 账单内尚未被任何计划占用、且无逾期/争议信号的交易本金（BR-INS-09 交叉去重、A-007 风险重检）。
 * 这里不做账单计算逻辑改造（原文 A-02），只为分期提供真实可分期金额与账期归属。
 */
@Service
public class BillingStatementService implements BillingPort {

    private static final int MAX_TRANSACTION_PAGES = 20;
    private static final int PAGE_SIZE = 100;

    private final AccountPort accountPort;
    private final TransactionPort transactionPort;
    private final PrincipalAllocationRepository allocationRepository;
    private final EligibilityFlagRepository eligibilityFlagRepository;
    private final ClockProvider clock;

    public BillingStatementService(AccountPort accountPort, TransactionPort transactionPort,
                                   PrincipalAllocationRepository allocationRepository,
                                   EligibilityFlagRepository eligibilityFlagRepository, ClockProvider clock) {
        this.accountPort = accountPort;
        this.transactionPort = transactionPort;
        this.allocationRepository = allocationRepository;
        this.eligibilityFlagRepository = eligibilityFlagRepository;
        this.clock = clock;
    }

    @Override
    public BillingStatement currentStatement(String accountId) {
        AccountPort.AccountSnapshot account = accountPort.getAccount(accountId);
        LocalDate today = clock.today();
        LocalDate cycleStart = cycleStart(account.openDate(), today);
        List<TransactionPort.TransactionView> purchases = purchasesInCycle(accountId, cycleStart, today);

        List<String> transactionIds = purchases.stream().map(TransactionPort.TransactionView::transactionId).toList();
        Map<String, BigDecimal> allocated = allocatedAmounts(transactionIds);

        List<BillingLine> lines = new ArrayList<>(purchases.size());
        BigDecimal billPrincipal = BigDecimal.ZERO.setScale(2);
        BigDecimal availablePrincipal = BigDecimal.ZERO.setScale(2);
        for (TransactionPort.TransactionView purchase : purchases) {
            billPrincipal = billPrincipal.add(purchase.amount());
            BigDecimal free = purchase.amount().subtract(
                    allocated.getOrDefault(purchase.transactionId(), BigDecimal.ZERO.setScale(2)));
            availablePrincipal = availablePrincipal.add(free);
            lines.add(new BillingLine(purchase.transactionId(), purchase.amount(),
                    purchase.processedTimestamp().toLocalDate(), purchase.description()));
        }
        String billId = "BILL" + YearMonth.from(today).toString().replace("-", "") + accountId;
        return new BillingStatement(billId, accountId, cycleStart, today,
                billPrincipal, availablePrincipal, List.copyOf(lines));
    }

    /** 账期起点：上月同一锚点日，月末自动截断到当月最后一天。 */
    public static LocalDate cycleStart(LocalDate openDate, LocalDate today) {
        int anchorDay = openDate.getDayOfMonth();
        YearMonth previousMonth = YearMonth.from(today).minusMonths(1);
        int day = Math.min(anchorDay, previousMonth.lengthOfMonth());
        return previousMonth.atDay(day);
    }

    private List<TransactionPort.TransactionView> purchasesInCycle(String accountId, LocalDate start, LocalDate end) {
        List<TransactionPort.TransactionView> purchases = new ArrayList<>();
        for (int page = 0; page < MAX_TRANSACTION_PAGES; page++) {
            List<TransactionPort.TransactionView> batch =
                    transactionPort.listAccountTransactions(accountId, page, PAGE_SIZE);
            if (batch.isEmpty()) {
                break;
            }
            for (TransactionPort.TransactionView transaction : batch) {
                if (!transaction.isPurchase() || !"POSTED".equals(transaction.status())) {
                    continue;
                }
                EligibilityFlag flag = eligibilityFlagRepository.findById(transaction.transactionId())
                        .orElse(null);
                if (flag != null && (flag.isDisputed() || flag.isDelinquent())) {
                    continue;
                }
                LocalDate posted = transaction.processedTimestamp().toLocalDate();
                if (!posted.isBefore(start) && !posted.isAfter(end)) {
                    purchases.add(transaction);
                }
            }
            if (batch.size() < PAGE_SIZE) {
                break;
            }
        }
        purchases.sort((left, right) -> left.processedTimestamp().compareTo(right.processedTimestamp()));
        return purchases;
    }

    private Map<String, BigDecimal> allocatedAmounts(List<String> transactionIds) {
        if (transactionIds.isEmpty()) {
            return Map.of();
        }
        Map<String, BigDecimal> allocated = new HashMap<>();
        for (PrincipalAllocation allocation : allocationRepository.findByTransactionIdIn(transactionIds)) {
            allocated.merge(allocation.getTransactionId(), allocation.getPrincipalAmount(), BigDecimal::add);
        }
        return allocated;
    }
}
