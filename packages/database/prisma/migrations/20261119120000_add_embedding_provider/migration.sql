-- 向量化服務欄位（change add-gemini-embedding-provider）。每一段都可以重複執行。

-- 0. 修正 km_articles.embedding 的維度（AUDIT DB-01）：init migration 建立 vector(1536)，
--    schema 與 UAT 是 vector(1024)。Gemini 向量化固定輸出 1024 維，所以欄位必須是 1024。
--    已經是 1024 維時不做任何事（UAT）。不是 1024 維時，既有向量無法和 1024 維的查詢比對，
--    先清空再改型別。
DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      WHERE a.attrelid = '"km_articles"'::regclass AND a.attname = 'embedding') <> 'vector(1024)' THEN
    UPDATE "km_articles" SET "embedding" = NULL, "embeddingModel" = NULL WHERE "embedding" IS NOT NULL;
    ALTER TABLE "km_articles" ALTER COLUMN "embedding" TYPE vector(1024);
  END IF;
END $$;

-- 1. 租戶的向量化服務，預設 ollama：既有租戶的行為不變
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "embeddingProvider" TEXT NOT NULL DEFAULT 'ollama';

-- 2. 既有向量補上模型名稱：搜尋只比對目前模型的向量，空值的向量會被過濾掉。
--    這些向量都是只有 Ollama 時產生的，所以補成租戶目前的模型；沒有設定列時補 bge-m3。
-- @backfill
UPDATE "km_articles" a
SET "embeddingModel" = COALESCE(
  (SELECT s."embeddingModel" FROM "tenant_settings" s WHERE s."tenantId" = a."tenantId"),
  'bge-m3'
)
WHERE a."embedding" IS NOT NULL
  AND (a."embeddingModel" IS NULL OR a."embeddingModel" = '');

-- @end
-- 3. Gemini 向量化的價格（每 1M token 美元，只有輸入價）
INSERT INTO "model_pricings" ("model", "inputPer1M", "outputPer1M", "cachedPer1M", "effectiveFrom")
VALUES ('gemini-embedding-001', 0.15, 0, 0, '2026-11-19T00:00:00Z')
ON CONFLICT ("model", "effectiveFrom") DO NOTHING;
