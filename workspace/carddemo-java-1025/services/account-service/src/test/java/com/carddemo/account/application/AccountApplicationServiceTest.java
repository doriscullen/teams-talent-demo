package com.carddemo.account.application;

import com.carddemo.account.domain.exception.BusinessRuleException;
import com.carddemo.account.domain.model.Account;
import com.carddemo.account.domain.model.AccountDetails;
import com.carddemo.account.domain.model.AccountPaymentEffect;
import com.carddemo.account.domain.repository.AccountRepository;
import com.carddemo.account.domain.repository.PaymentEffectRepository;
import com.carddemo.account.domain.repository.RewardCreditRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 账户端还款效果去重（A-001）：同一 effectId 只扣减一次余额；
 * 内容不一致视为冲突；非法/超余额还款仍按原有账单支付规则拒绝。
 */
class AccountApplicationServiceTest {

    private static final String ACCOUNT = "00000000006";

    private AccountRepository accounts;
    private PaymentEffectRepository paymentEffects;
    private AccountApplicationService service;
    private final Map<String, AccountPaymentEffect> effects = new HashMap<>();

    @BeforeEach
    void setUp() {
        accounts = mock(AccountRepository.class);
        paymentEffects = mock(PaymentEffectRepository.class);
        Account account = new Account(ACCOUNT, new AccountDetails("Y", new BigDecimal("2450.75"),
                new BigDecimal("8000.00"), new BigDecimal("3000.00"), LocalDate.of(2018, 3, 9),
                LocalDate.of(2027, 3, 9), LocalDate.of(2027, 3, 9), new BigDecimal("300.75"),
                new BigDecimal("100.00"), "10006", "C000000000"));
        when(accounts.findByAccountId(ACCOUNT)).thenReturn(Optional.of(account));
        when(accounts.findForUpdate(ACCOUNT)).thenReturn(Optional.of(account));
        when(accounts.saveAccount(any(Account.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(paymentEffects.findByEffectId(anyString())).thenAnswer(invocation ->
                Optional.ofNullable(effects.get(invocation.getArgument(0))));
        when(paymentEffects.saveEffect(any(AccountPaymentEffect.class))).thenAnswer(invocation -> {
            AccountPaymentEffect effect = invocation.getArgument(0);
            effects.put(effect.getEffectId(), effect);
            return effect;
        });
        service = new AccountApplicationService(accounts, mock(RewardCreditRepository.class), paymentEffects);
    }

    @Test
    void sameEffectIdAppliesPaymentOnlyOnce() {
        Account first = service.applyIdempotentPayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-1");
        Account replay = service.applyIdempotentPayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-1");

        assertThat(first.getCurrentBalance()).isEqualByComparingTo("1850.75");
        assertThat(replay.getCurrentBalance()).isEqualByComparingTo("1850.75");
        assertThat(effects.get("SETTLE-1").getBalanceAfter()).isEqualByComparingTo("1850.75");
    }

    @Test
    void sameEffectIdWithDifferentAmountIsRejected() {
        service.applyIdempotentPayment(ACCOUNT, new BigDecimal("600.00"), "SETTLE-1");

        assertThatThrownBy(() -> service.applyIdempotentPayment(ACCOUNT, new BigDecimal("500.00"), "SETTLE-1"))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void paymentWithoutEffectIdKeepsLegacyBehaviour() {
        Account account = service.applyIdempotentPayment(ACCOUNT, new BigDecimal("50.00"), null);

        assertThat(account.getCurrentBalance()).isEqualByComparingTo("2400.75");
        assertThat(effects).isEmpty();
    }

    @Test
    void paymentOverBalanceIsRejected() {
        assertThatThrownBy(() -> service.applyIdempotentPayment(ACCOUNT, new BigDecimal("9999.00"), "SETTLE-2"))
                .isInstanceOf(BusinessRuleException.class)
                .extracting("code").isEqualTo("PAYMENT_EXCEEDS_BALANCE");
        assertThat(effects).isEmpty();
    }
}
