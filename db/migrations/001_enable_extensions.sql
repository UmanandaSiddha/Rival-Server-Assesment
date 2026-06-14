-- migrate:up

-- gen_random_uuid() for text id defaults.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram index support for fast case-insensitive task title search (ILIKE '%term%').
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- migrate:down

DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS pgcrypto;
