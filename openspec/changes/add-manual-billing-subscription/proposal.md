## Why

open333CRM 目前多租戶架構已有 `Plan`（方案定義）與 `PlanChangeRequest`（升級/加購申請 → 平台審核）機制，但缺少「訂閱」與「帳單」兩個核心概念：`Plan.priceMonthly` 明確標註「顯示用，不接金流」，租戶目前的計費狀態、生效區間、實際收款紀錄完全沒有資料模型承載，平台方也沒有後台介面可以完成「開通/加購/續約/停用」的記帳與生效。要讓系統可以商用販售（金流服務商尚未申請下來，短期仍為人工對帳），必須先把訂閱生命週期與帳單留痕的資料結構與操作流程建好，並讓付款方式欄位從第一天就設計成可插拔（MANUAL 起步，未來加 Stripe/綠界/藍新等 adapter 不需要重新設計 schema）。此提案也是「合約到期停用/續約」（另案）與「模組化銷售」的地基。

## What Changes

- 新增 `Subscription` model：承載租戶目前訂閱的方案、生效區間、計費週期、狀態（trial/active/past_due/canceled/expired），與 `Tenant.planId` 現有欄位並存但職責分離——`Tenant.planId` 保留為「目前生效方案」的執行期查詢捷徑，`Subscription` 是完整歷程與狀態機。
- 新增 `Invoice` model：帳單留痕，即使是人工請款也要記錄金額、幣別、方案快照、計費週期、狀態（draft/issued/paid/void）、付款方式（先只有 `MANUAL`，enum 設計上可擴充 `STRIPE`/`ECPAY`/`NEWEBPAY` 等）、手動收款備註與憑證附件（沿用既有 storage 機制）。
- 新增 `PaymentProvider` 介面抽象（`packages/database` 之外的程式碼層，位於 `apps/api/src/modules/billing/providers/`）：定義 `charge()`/`refund()`/`verifyWebhook()` 等方法簽章，本次只實作 `ManualPaymentProvider`（純記帳、無外部呼叫），未來新增 `StripePaymentProvider` 等只需新增 adapter class，不動呼叫端與資料模型。
- 新增平台後台頁面（`apps/web/src/app/admin/`）：建立/修改租戶訂閱、手動開立與確認 Invoice 收款、加購模組/方案升降級生效（銜接既有 `PlanChangeRequest` 審核流程，核准後落地為 Subscription 異動 + Invoice）。
- 新增租戶方唯讀頁面（`apps/web/src/app/dashboard/plan/`擴充）：目前方案、訂閱狀態、帳單歷程列表（不含自助升級/自助刷卡）。
- 預留 Webhook 端點 `POST /api/webhooks/billing/:provider`（本次只註冊路由與簽章驗證骨架，回 501，不實作真實金流商回呼邏輯）。
- **不含**：實際金流串接（Stripe/綠界等 SDK 呼叫）、自助線上刷卡、自動扣款重試邏輯、合約到期自動停用（見另案 `add-contract-lifecycle-automation`）。

## Capabilities

### New Capabilities
- `billing-subscription`：租戶訂閱生命週期（建立、變更方案、狀態機轉換）與帳單記錄（Invoice 建立、人工收款確認、憑證附件）的資料模型與 CRUD 能力，含可插拔的 PaymentProvider 抽象與 MANUAL 實作。

### Modified Capabilities
（無現有 spec 的 requirement 層行為變更；`channel-billing`／`license-service`／`team-license` 三份既有 spec 是舊版「中控 License Server + License JSON」構想遺留，專案已改走 `Plan`/`PlatformUser`/`platform control plane` 架構，本次不修改、不依賴這三份 spec，避免與已過時設計混淆。）

## Impact

- **Schema**：`packages/database/prisma/schema.prisma` 新增 `Subscription`、`Invoice` model + 對應 enum（`SubscriptionStatus`、`InvoiceStatus`、`PaymentMethod`），需要正式 Prisma migration（不得 db push）。
- **API**：`apps/api/src/modules/billing/`（新模組）：subscription CRUD、invoice CRUD、manual payment 確認端點、webhook 骨架路由；沿用 `requireAdmin()`/`requireSupervisor()` guard、Zod 驗證、`AppError`、tenantId 隔離慣例。
- **前端**：`apps/web/src/app/admin/`（平台方訂閱與帳單管理頁）、`apps/web/src/app/dashboard/plan/`（租戶方唯讀擴充）。
- **關聯既有機制**：`PlanChangeRequest` 核准流程需擴充為同時寫入 `Subscription` 異動與產生對應 `Invoice`；`PlatformAuditLog`/`TenantAuditLog` 需記錄訂閱與帳單操作。
- **不影響**：RLS 隔離機制（新表比照現有租戶表接線）、既有 Plan entitlement 執行期檢查邏輯。
