-- Reverse of 000001_enable_extensions.up.sql.
--
-- pgcrypto may be shared by other schemas in the same database, so dropping it
-- is intentionally conditional. If nothing else depends on it, this removes it.

DROP EXTENSION IF EXISTS pgcrypto;
