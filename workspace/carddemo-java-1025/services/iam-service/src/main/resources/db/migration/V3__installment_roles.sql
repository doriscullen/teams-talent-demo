-- REQ-2026-001 分期角色种子：后台权限区分需要真实可登录身份（AC-21）
-- 密码与 ADMIN001 相同，均为 admin123 的 PBKDF2 哈希（本地演示专用，ADR-008）
INSERT INTO sec_user (user_id, first_name, last_name, password_hash, user_type, version)
VALUES ('ADMIN002', 'Staff', 'Assistant',
        'pbkdf2$210000$n25aKv4JuPM8wKaNo/11KQ==$jz7ISZRkT3GCAw5Bp7Bz9qnh/f1X9fRUavGfTgJhrB8=',
        'A', 0),
       ('ADMIN003', 'Risk', 'ReadOnly',
        'pbkdf2$210000$n25aKv4JuPM8wKaNo/11KQ==$jz7ISZRkT3GCAw5Bp7Bz9qnh/f1X9fRUavGfTgJhrB8=',
        'A', 0),
       ('USER0002', 'Demo', 'SecondCustomer',
        'pbkdf2$210000$n25aKv4JuPM8wKaNo/11KQ==$jz7ISZRkT3GCAw5Bp7Bz9qnh/f1X9fRUavGfTgJhrB8=',
        'U', 0);
