-- Intentionally irreversible.
--
-- devices.id has been the table's primary key since migration 0003. Migration
-- 0057 only repairs environments where that foundational constraint drifted
-- away, so rolling 0057 back must not recreate the broken schema.
SELECT 1;
