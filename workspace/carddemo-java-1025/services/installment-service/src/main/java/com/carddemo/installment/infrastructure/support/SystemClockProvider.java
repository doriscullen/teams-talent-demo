package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.application.port.ClockProvider;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

@Component
public class SystemClockProvider implements ClockProvider {

    @Override
    public LocalDateTime now() {
        return LocalDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS);
    }
}
