package com.carddemo.installment.domain.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 账户作用ID（A-R004）：服务端按「操作类型 + 计划实体 + 客户端幂等键」生成稳定标识，
 * 不直接使用客户端键，也不同操作共享命名空间，因此还款与结清即使客户端键相同也不会相互碰撞。
 * 同一逻辑动作重复提交得到同一 effectId（账户端据此只扣一次）。
 */
public final class EffectIds {

    private static final int HASH_CHARS = 40;

    private EffectIds() {
    }

    public static String repayment(String planId, String paymentKey) {
        return build("REPAY", planId, paymentKey);
    }

    public static String settlement(String planId, String settlementKey) {
        return build("SETTLE", planId, settlementKey);
    }

    static String build(String operation, String entityId, String clientKey) {
        String material = operation + "|" + entityId + "|" + (clientKey == null ? "" : clientKey);
        return operation + "-" + sha256(material).substring(0, HASH_CHARS);
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }
}
