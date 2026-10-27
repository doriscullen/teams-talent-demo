package com.carddemo.installment.infrastructure.support;

import com.carddemo.installment.domain.model.NotificationOutbox;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * 本地通知投递适配器（C-03）：本演示不接外部短信厂商，但必须真实投递并可观察。
 * <p>
 * 每条通知写成一个投递文件（原子落盘）；{@code .offline} 标记代表本地投递目标不可用，
 * 供故障注入验证「失败可见 + 恢复补发」，不会静默丢弃也不会把待发送当成已发送。
 */
@Component
public class LocalNotificationSender {

    private static final String OFFLINE_MARKER = ".offline";

    private final Path deliveryDir;

    public LocalNotificationSender(
            @Value("${installment.notification.delivery-dir:/var/lib/carddemo/notifications}") String dir) {
        this.deliveryDir = Path.of(dir);
    }

    public void send(NotificationOutbox notification) throws IOException {
        if (Files.exists(deliveryDir.resolve(OFFLINE_MARKER))) {
            throw new IOException("local notification sink is offline");
        }
        Files.createDirectories(deliveryDir);
        Path target = deliveryDir.resolve(notification.getNotificationId() + "-" + notification.getChannel() + ".json");
        Path temp = Files.createTempFile(deliveryDir, "notification-", ".tmp");
        Files.writeString(temp, render(notification), StandardCharsets.UTF_8);
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    /** 切换本地投递目标的可用性（故障注入 / 恢复验证）。 */
    public void setAvailable(boolean available) {
        try {
            if (available) {
                Files.deleteIfExists(deliveryDir.resolve(OFFLINE_MARKER));
            } else {
                Files.createDirectories(deliveryDir);
                Files.writeString(deliveryDir.resolve(OFFLINE_MARKER), "offline", StandardCharsets.UTF_8);
            }
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to toggle local notification sink", ex);
        }
    }

    public boolean isAvailable() {
        return !Files.exists(deliveryDir.resolve(OFFLINE_MARKER));
    }

    public long deliveredFileCount() {
        if (!Files.isDirectory(deliveryDir)) {
            return 0;
        }
        try (var stream = Files.list(deliveryDir)) {
            return stream.filter(path -> path.getFileName().toString().endsWith(".json")).count();
        } catch (IOException ex) {
            return 0;
        }
    }

    private static String render(NotificationOutbox notification) {
        return "{\"notificationId\":" + notification.getNotificationId()
                + ",\"channel\":\"" + notification.getChannel()
                + "\",\"recipient\":\"" + notification.getRecipient()
                + "\",\"template\":\"" + notification.getTemplate()
                + "\",\"payload\":\"" + (notification.getPayload() == null ? "" :
                notification.getPayload().replace("\"", "'"))
                + "\"}\n";
    }
}
