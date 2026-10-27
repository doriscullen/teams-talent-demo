package com.carddemo.account.infrastructure.persistence;

import com.carddemo.account.domain.model.AccountPaymentEffect;
import com.carddemo.account.domain.repository.PaymentEffectRepository;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PaymentEffectJpaRepository
        extends JpaRepository<AccountPaymentEffect, String>, PaymentEffectRepository {

    @Override
    default Optional<AccountPaymentEffect> findByEffectId(String effectId) {
        return findById(effectId);
    }

    @Override
    default AccountPaymentEffect saveEffect(AccountPaymentEffect effect) {
        return save(effect);
    }
}
