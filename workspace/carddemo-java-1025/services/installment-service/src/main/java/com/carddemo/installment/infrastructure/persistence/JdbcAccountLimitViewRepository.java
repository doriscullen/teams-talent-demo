package com.carddemo.installment.infrastructure.persistence;

import com.carddemo.installment.domain.repository.AccountLimitViewRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;

/** 读取 V7 建立的 {@code account_limit_view}（视图口径唯一，应用层不再自行累加）。 */
@Repository
public class JdbcAccountLimitViewRepository implements AccountLimitViewRepository {

    private final JdbcTemplate jdbc;

    public JdbcAccountLimitViewRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Occupancy findOccupancy(String accountId) {
        List<Occupancy> rows = jdbc.query(
                "select installment_occupied, active_plan_count from account_limit_view where account_id = ?",
                (rs, rowNum) -> new Occupancy(rs.getBigDecimal("installment_occupied"),
                        rs.getLong("active_plan_count")),
                accountId);
        return rows.isEmpty() ? new Occupancy(new BigDecimal("0.00"), 0) : rows.get(0);
    }
}
