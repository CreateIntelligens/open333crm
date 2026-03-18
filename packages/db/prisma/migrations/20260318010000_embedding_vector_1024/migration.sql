-- Change embedding dimension from 1536 to 1024 for BGE-M3 model
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE km_articles ALTER COLUMN embedding TYPE vector(1024);
