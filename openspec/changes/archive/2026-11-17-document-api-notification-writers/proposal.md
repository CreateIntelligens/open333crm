## Why

主規格 `standalone-worker-runtime` 有三處和程式不一致：

1. 「Notification Job Consumer」規定 `apps/workers` 是**唯一**寫入站內通知的程式。實際上 API 行程也直接寫入 4 種通知：CSAT 低分、FB／IG 權杖失效、留言私訊健康告警、序號明細背景匯出的結果。
2. 「站內通知只寫給仍啟用的成員」列出 API 行程寫入通知的入口，但漏了留言私訊健康告警。這個入口由 #526（change `add-comment-keyword-private-reply`）新增。
3. 同一條需求的 scenario 寫推播送到 `agent:<成員 ID>`。#337 階段 4 第七批（commit `248010df`）把 API 行程寫入的通知改成在租戶交易內寫入，commit 之後才推播，房間也改成 `tenant:<租戶 ID>:agent:<成員 ID>`。

## What Changes

- 「Notification Job Consumer」改成：workers 是事件觸發的通知的唯一寫入者，例外見新需求「API 行程直接寫入的站內通知」。
- 新增「API 行程直接寫入的站內通知」：列出 API 行程直接寫入的 4 種通知，新的通知類型經過 `notification` 佇列。
- 「站內通知只寫給仍啟用的成員」補上留言私訊健康告警，scenario 的房間改成 `tenant:<租戶 ID>:agent:<成員 ID>`。
- 新增「API 行程寫入的站內通知在 commit 之後才推播」：交易 commit 之後才推播；交易 rollback 時不留下通知，也不推播。

這個 change 只改規格。程式的行為已經在 commit `248010df` 完成，測試也已經寫好。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `standalone-worker-runtime`：修改「Notification Job Consumer」與「站內通知只寫給仍啟用的成員」，新增「API 行程直接寫入的站內通知」與「API 行程寫入的站內通知在 commit 之後才推播」。

## Impact

- 只改 `openspec/specs/standalone-worker-runtime/spec.md`。程式、API、資料庫都不變。

## Platform layer

沒有任何一項適用：這個 change 只更正規格的文字，沒有新增權限碼、功能模組、上限、AI 呼叫、渠道類型、平台設定、平台稽核動作、佇列或租戶與平台之間的請求。
