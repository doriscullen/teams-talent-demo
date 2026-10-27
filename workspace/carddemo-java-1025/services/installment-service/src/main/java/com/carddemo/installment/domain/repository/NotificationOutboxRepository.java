package com.carddemo.installment.domain.repository;

import com.carddemo.installment.domain.model.NotificationOutbox;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {

    List<NotificationOutbox> findByStatusInOrderByNotificationIdAsc(List<String> statuses);

    List<NotificationOutbox> findAllByOrderByNotificationIdAsc();

    /**
     * 认领一条待投递通知：只有把 PENDING/FAILED 原子改成 SENDING 的调用者才真正投递，
     * 避免并发 worker 重复通知。
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update NotificationOutbox n set n.status = 'SENDING' "
            + "where n.notificationId = :id and n.status in ('PENDING', 'FAILED')")
    int claim(@Param("id") Long notificationId);
}
