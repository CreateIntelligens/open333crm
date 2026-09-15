## Context

目前 `apps/api/src/modules/email/email.service.ts` 已是所有系統郵件的集中入口，並以 delivery mode 分派到 `log`、`webhook` 或 `smtp`。SMTP 實作透過 lazy-loaded Nodemailer transporter；環境設定集中在 `apps/api/src/config/env.ts`。試用、平台帳號、用量告警與畫布流程都呼叫同一個 `sendEmail()`，因此不需要逐一改寫郵件模板。

Resend 的 Node.js SDK 支援以 `from`、`to`、`subject`、`html` 與 `text` 發送郵件，成功回應包含 message ID；寄件網域必須先在 Resend 驗證。參考：[Resend Node.js guide](https://resend.com/docs/send-with-nodejs) 與 [Send Email API reference](https://resend.com/docs/api-reference/emails/send-email)。

## Goals / Non-Goals

**Goals:**

- 在既有集中式郵件服務中加入 Resend provider。
- 讓正式環境可以只用 API key 與已驗證寄件人，不依賴 Gmail SMTP。
- 保留現有 delivery mode 與呼叫端介面，提供可回退的部署路徑。
- 讓設定錯誤與 provider 錯誤可診斷，並避免敏感資料進 log。

**Non-Goals:**

- 不改寫既有 HTML 郵件模板與觸發業務流程。
- 不新增資料庫表、郵件管理 UI、寄件統計或 Resend webhook 事件處理。
- 不在 Resend 失敗時自動 fallback 到 SMTP，也不在本 change 加入跨 provider 的重試佇列。
- 不移除 SMTP 程式碼或立即撤銷既有 SMTP secret；移除可在確認所有環境完成切換後另立 change。

## Decisions

### D1. 使用 Resend 官方 Node SDK

採用 `resend` npm 套件，而不是在服務內自行組 HTTP `fetch`。SDK 已提供寄送欄位型別與 provider 回應，且與 API 的 Node.js 使用方式一致；自行呼叫 HTTP 會重複維護 endpoint、錯誤解析與型別。API key 只從後端環境讀取，不進前端 bundle。

### D2. 以現有 delivery mode 擴充，不替換共用入口

在 `sendEmail()` 的 mode dispatch 新增 `resend` 分支，使用同一個 `SendEmailInput`。這可讓所有現有郵件路徑自然取得 Resend 支援，並維持 `log` 作為本機預設、`webhook`/`smtp` 作為相容模式。另一個方案是讓各模組直接 import Resend client，但會造成設定、錯誤處理與敏感資訊治理分散，故不採用。

### D3. Lazy singleton client，使用已驗證寄件人

沿用目前 SMTP transporter 的 lazy singleton pattern，在首次 Resend 寄信時建立 client，避免只啟動 API 而未使用郵件時初始化 provider。`EMAIL_FROM` 作為 Resend `from` 欄位；Resend 模式不使用現有 SMTP 欄位，也不給予 `.local` 預設寄件人。必要設定由 env schema 在啟動/首次讀取時擋下。

### D4. Provider error 不自動跨 provider fallback

Resend 呼叫失敗時直接回傳錯誤給現有呼叫端。若同一封信再透過 SMTP 寄送，遠端可能已接受但本地逾時，容易造成重複郵件；部署切換應由環境設定與運維操作控制。現有 `safeSend` 的 fire-and-forget/log 行為維持不變。

### D5. 以 provider message ID 支援診斷，但不改動郵件呼叫端

Resend 成功回傳的 ID 只寫入結構化郵件成功 log 或 metadata，`sendEmail()` 仍維持 `Promise<void>`，避免本次 change 擴大到所有模板呼叫端。任何 log 都不得包含 API key、Authorization header 或完整 HTML body。

### D6. 測試採 client mock，不依賴真實 Resend 帳號

新增 email service 測試，mock `resend` client，驗證 mode dispatch、欄位映射、設定驗證、錯誤傳遞與不觸發 SMTP fallback。另以既有呼叫路徑的 smoke-level 測試確認模板仍呼叫共用 service；不在 CI 寄送真實郵件。

## Risks / Trade-offs

- **[Risk] 寄件網域未在 Resend 驗證，正式寄送被拒。** → 部署 runbook 與環境文件明確要求先驗證 domain，並用 `EMAIL_FROM` 設定該網域的寄件人。
- **[Risk] Resend API key 外洩。** → 只放 API server secret，env schema 錯誤與 log 做遮罩；不把 key 放進 `NEXT_PUBLIC_*` 或回應。
- **[Risk] provider timeout 造成寄送狀態不確定。** → 不自動切換 provider；保留 provider message ID 與錯誤摘要，後續若需要可靠投遞再另立 idempotency/queue change。
- **[Risk] 舊環境仍依賴 SMTP。** → 保留 `smtp` mode 與 Nodemailer，先以 `EMAIL_DELIVERY_MODE=resend` 灰度切換，確認後才考慮移除 SMTP。
- **[Risk] API SDK 版本或 runtime 相容性。** → 鎖定 pnpm lockfile，執行 API build、lint 與 email service 測試。

## Migration Plan

1. 新增 `resend` dependency、環境 schema 與 email service provider，完成單元測試。
2. 在 Resend 建立並驗證寄件網域，建立具最小寄送權限的 API key。
3. 將部署環境設定 `RESEND_API_KEY`、`EMAIL_FROM` 與 `EMAIL_DELIVERY_MODE=resend`；保留既有 SMTP secret 作回退用。
4. 以試用驗證信、平台開通信與用量告警各驗證一封，檢查 Resend message ID、收件結果與 API log。
5. 若需回退，將 `EMAIL_DELIVERY_MODE` 改回 `smtp` 並確認原 SMTP 設定仍存在；不需資料庫 rollback。
