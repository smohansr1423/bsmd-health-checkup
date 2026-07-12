-- Task 2.1 — Define PostgreSQL schema and migrations (User & Profile Service).
--
-- Enable the extensions the rest of the schema relies on. pgcrypto provides
-- gen_random_uuid() for UUID primary keys on PostgreSQL versions where it is
-- not already built in.
--
-- Requirements: 3.6, 16.6, 17.1, 19.1, 25.6

CREATE EXTENSION IF NOT EXISTS pgcrypto;
