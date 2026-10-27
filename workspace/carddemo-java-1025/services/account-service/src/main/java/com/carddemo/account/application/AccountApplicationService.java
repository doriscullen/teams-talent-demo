package com.carddemo.account.application;

import com.carddemo.account.domain.exception.BusinessRuleException;
import com.carddemo.account.domain.exception.NotFoundException;
import com.carddemo.account.domain.model.Account;
import com.carddemo.account.domain.model.AccountDetails;
import com.carddemo.account.domain.model.AccountPaymentEffect;
import com.carddemo.account.domain.model.RewardCredit;
import com.carddemo.account.domain.repository.AccountRepository;
import com.carddemo.account.domain.repository.PaymentEffectRepository;
import com.carddemo.account.domain.repository.RewardCreditRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 账户用例服务。对应遗留程序 COACTVWC（查询）、COACTUPC（维护）、
 * CBTRN02C（记账）、COBIL00C（还款）、CBACT04C（利息入账）。
 */
@Service
@Transactional
public class AccountApplicationService {

    private final AccountRepository accounts;
    private final RewardCreditRepository rewardCredits;
    private final PaymentEffectRepository paymentEffects;

    public AccountApplicationService(AccountRepository accounts, RewardCreditRepository rewardCredits,
                                     PaymentEffectRepository paymentEffects) {
        this.accounts = accounts;
        this.rewardCredits = rewardCredits;
        this.paymentEffects = paymentEffects;
    }

    @Transactional(readOnly = true)
    public Account getById(String accountId) {
        return accounts.findByAccountId(accountId)
                .orElseThrow(() -> new NotFoundException("ACCOUNT_NOT_FOUND",
                        "Account " + accountId + " not found"));
    }

    @Transactional(readOnly = true)
    public List<Account> findAll() {
        return accounts.findAllAccounts();
    }

    public Account update(String accountId, AccountDetails details) {
        Account account = getById(accountId);
        account.applyDetails(details);
        return accounts.saveAccount(account);
    }

    public Account applyPosting(String accountId, BigDecimal amount) {
        Account account = getById(accountId);
        account.applyPosting(amount);
        return accounts.saveAccount(account);
    }

    public Account applyBillPayment(String accountId, BigDecimal amount) {
        Account account = getById(accountId);
        account.applyBillPayment(amount);
        return accounts.saveAccount(account);
    }

    /**
     * 幂等还款（A-001）：账户行先加锁，再按 effectId 判定是否已执行。
     * <p>
     * 首次执行扣减余额并落作用记录；同 effectId 重试（包括远端已成功但响应丢失）只校验内容并返回首次结果，
     * 不会二次扣减。不同金额或账户复用同一 effectId 视为冲突。
     */
    public Account applyIdempotentPayment(String accountId, BigDecimal amount, String effectId) {
        if (effectId == null || effectId.isBlank()) {
            return applyBillPayment(accountId, amount);
        }
        Account account = accounts.findForUpdate(accountId)
                .orElseThrow(() -> new NotFoundException("ACCOUNT_NOT_FOUND",
                        "Account " + accountId + " not found"));
        AccountPaymentEffect existing = paymentEffects.findByEffectId(effectId).orElse(null);
        if (existing != null) {
            if (!existing.getAccountId().equals(accountId) || existing.getAmount().compareTo(amount) != 0) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_CONFLICT",
                        "effectId is already used by another payment.");
            }
            return account;
        }
        account.applyBillPayment(amount);
        Account saved = accounts.saveAccount(account);
        AccountPaymentEffect effect = new AccountPaymentEffect(effectId, accountId, amount, LocalDateTime.now());
        effect.markApplied(saved.getCurrentBalance());
        paymentEffects.saveEffect(effect);
        return saved;
    }

    public Account accrueInterest(String accountId, BigDecimal amount) {
        Account account = getById(accountId);
        account.accrueInterest(amount);
        return accounts.saveAccount(account);
    }

    /**
     * 营销返现入账（幂等）：同一 rewardId 重复调用只入账一次。
     */
    public Account creditCashback(String accountId, String rewardId, String campaignId, BigDecimal amount) {
        if (rewardCredits.existsByRewardId(rewardId)) {
            return getById(accountId);
        }
        Account account = getById(accountId);
        account.applyCashback(amount);
        Account saved = accounts.saveAccount(account);
        rewardCredits.saveCredit(new RewardCredit(rewardId, accountId, campaignId, amount,
                LocalDateTime.now()));
        return saved;
    }
}
