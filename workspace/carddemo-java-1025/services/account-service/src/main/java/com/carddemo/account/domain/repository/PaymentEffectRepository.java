package com.carddemo.account.domain.repository;

import com.carddemo.account.domain.model.AccountPaymentEffect;

import java.util.Optional;

public interface PaymentEffectRepository {

    Optional<AccountPaymentEffect> findByEffectId(String effectId);

    AccountPaymentEffect saveEffect(AccountPaymentEffect effect);
}
