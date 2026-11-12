-- 傑克電機內部系統：建立專用資料庫與「有限權限」帳號
-- 在 XAMPP 的 phpMyAdmin「SQL」分頁貼上執行（用 root 或有權限建立帳號的管理帳號）。
-- 這個帳號只能使用 jaker_apps 這個資料庫，碰不到文管系統的資料。
-- 程式跟 MySQL 在同一台電腦上，所以只允許從本機登入。
-- 【請先把兩處「請改成16碼以上的隨機密碼」換成同一組密碼，密碼不要貼到聊天或信件裡】

CREATE DATABASE IF NOT EXISTS jaker_apps CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'jaker_apps'@'localhost' IDENTIFIED BY '請改成16碼以上的隨機密碼';
CREATE USER 'jaker_apps'@'127.0.0.1' IDENTIFIED BY '請改成16碼以上的隨機密碼';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP ON jaker_apps.* TO 'jaker_apps'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP ON jaker_apps.* TO 'jaker_apps'@'127.0.0.1';

FLUSH PRIVILEGES;
