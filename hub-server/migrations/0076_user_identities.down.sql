-- Data-bearing migration: rollback to older code must not destroy the new
-- identity links. Operators may restore a pre-0076 database dump if they
-- intentionally need to reverse the schema.
SELECT 1;
