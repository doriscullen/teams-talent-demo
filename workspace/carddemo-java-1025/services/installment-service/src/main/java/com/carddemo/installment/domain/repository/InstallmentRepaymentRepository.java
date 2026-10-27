package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.InstallmentRepayment;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface InstallmentRepaymentRepository extends JpaRepository<InstallmentRepayment, String> {

    /**
     * 计划锁内重新确认还款意图（A-R003c）：悲观写锁强制从数据库读取当前行，
     * 不使用调用前读到的一级缓存旧快照。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from InstallmentRepayment r where r.paymentKey = :paymentKey")
    Optional<InstallmentRepayment> findForUpdate(@Param("paymentKey") String paymentKey);

    List<InstallmentRepayment> findByPlanIdOrderByCreatedAtAsc(String planId);

    boolean existsByPlanIdAndStatus(String planId, String status);

    /** 同一计划下是否有其它还款键在途（A-R003b：计划级在途占用，跨键互斥）。 */
    boolean existsByPlanIdAndStatusAndPaymentKeyNot(String planId, String status, String paymentKey);

    List<InstallmentRepayment> findByStatusInAndUpdatedAtBefore(Collection<String> statuses,
                                                               LocalDateTime before);
}
