-- 0059_execution_target_evidence.down.sql
-- 回滚健康证据表（#1544）。执行前服务已回退到旧版二进制，
-- 不再读取 evidence；target 行上的旧 health 字段未被动过。

DROP TABLE IF EXISTS execution_target_evidence;
