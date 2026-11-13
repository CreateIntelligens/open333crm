# Proposal

## Why

SES SMTP 故障時，系統郵件目前無法改由 Resend 投遞。大量同時寄信與恢復探測可能放大供應商故障。

## What Changes

- 提供明確啟用的 SES SMTP 至 Resend 故障切換，限制並協調故障期間的供應商請求。
- 對無法判定 SES 是否收件的錯誤保留失敗結果，避免同一封信跨供應商重送。
- 提供獨立的備援寄件人與可診斷的切換狀態。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `email-delivery`: 加入 SMTP 至 Resend 的安全切換與恢復。

## Impact

共用郵件服務、API 設定、Redis 協調、郵件服務測試與部署設定。

## Platform layer

不新增權限、方案功能或限制、AI、渠道、平台狀態、稽核動作、佇列或跨平台請求；平台郵件沿用共用郵件服務。
