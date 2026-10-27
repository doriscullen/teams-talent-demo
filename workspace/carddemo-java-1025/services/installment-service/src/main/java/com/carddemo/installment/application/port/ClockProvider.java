package com.carddemo.installment.application.port;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

/** 时钟端口：账期/T+1/令牌过期都用同一时区口径（test-profile-v2：Asia/Shanghai）。 */
public interface ClockProvider {

    ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    LocalDateTime now();

    default LocalDate today() {
        return now().toLocalDate();
    }
}
