-- AlterTable: 新增 sentiment-aware handoff 與 BOT 閒置自動結束相關欄位
ALTER TABLE "tenant_settings"
  ADD COLUMN "handoffOnNegativeSentiment" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "negativeSentimentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  ADD COLUMN "botInactivityCloseHours" INTEGER NOT NULL DEFAULT 1;
