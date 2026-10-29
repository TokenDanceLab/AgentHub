DROP TABLE IF EXISTS browser_sessions;
-- Revocation generations and replay evidence must survive a schema rollback.
-- Removing browser sessions fails closed. Never erase issuer/sub epochs to
-- make an older credential valid again. Reapply up to restore the browser table.
