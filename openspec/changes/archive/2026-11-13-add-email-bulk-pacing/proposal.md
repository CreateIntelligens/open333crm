# Proposal

## Why

目前系統僅限制同時連線數（SMTP 3、Resend 5），沒有依供應商每秒上限自動限速、分批排隊與節流退避。一次觸發 5,000 封郵件時，超出並行數的呼叫會立即失敗，也可能觸發 AWS SES `454 Maximum sending rate exceeded` 誤切到 Resend，或讓大量批次郵件佔滿額度影響驗證碼等即時系統信。

## What Changes

- 新增可依環境參數調整的郵件速率、並行數、冷卻與批次大小設定（`EMAIL_SMTP_MAX_CONCURRENCY`、`EMAIL_SMTP_RATE_PER_SEC`、`EMAIL_SMTP_BULK_RATE_PER_SEC`、`EMAIL_RESEND_MAX_CONCURRENCY`、`EMAIL_RESEND_RATE_PER_SEC`、`EMAIL_FAILOVER_COOLDOWN_MS`、`EMAIL_BATCH_SIZE`）。
- 在 Redis Lua 協調器加入跨實例 1 秒滑動視窗限速與批次額度保留，確保總速率受限並為即時交易郵件保留空間。
- 區分 SES 短暫速率節流（`454 Maximum sending rate exceeded`）與服務中斷／每日額度耗盡：速率節流採延遲退避重試，不誤開 Resend 電路。
- 新增 `email-dispatch` BullMQ 佇列、`enqueueEmailBatch()` 自動分批錯峰投遞，並將 Canvas 郵件發送接入此佇列，支援 5,000 封級別的平滑發送與失敗重試。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `email-delivery`: 新增依環境參數自動限速、分批佇列、批次與即時優先級保留，以及區分速率節流與服務中斷。

## Impact

`@open333crm/core` 佇列常數、API 環境設定、郵件協調器與寄信服務、新增 `email-queue.ts`、Canvas worker、佇列監控清單與對應單元／整合測試。

## Platform layer

本變更不新增權限碼、方案功能開關、方案數值上限、AI 模型呼叫、渠道類型、平台管理頁面或平台稽核動作。唯一相關項目為新增 `email-dispatch` BullMQ 佇列，已依規定加入 `apps/api/src/modules/queue-monitoring/monitored-queues.ts`，使平台佇列監控可檢視與重送失敗工作。
