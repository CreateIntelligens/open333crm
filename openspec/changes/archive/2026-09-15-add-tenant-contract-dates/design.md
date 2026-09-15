## Context

平台控制層（`platform-control-plane`）已具備租戶方案（`planId`）、數值上限（`plan.limits` + `Tenant.limitOverrides`）、試用生命週期（`trialEndsAt` + trial scheduler 自動停用）。缺的是「付費租戶的合約期間」——BD/營運需要在平台後台記錄與查看每個租戶合約的起訖日，用於續約追蹤、對帳、客戶溝通。

現有相近欄位是 `Tenant.trialEndsAt`，但語意不同：`trialEndsAt` 到期會被 trial scheduler 自動停用租戶（`isActive=false`）。合約日期則是**純記錄**，不觸發任何自動行為——這個界線是本設計的核心。

平台認證已有 `authenticatePlatformSuperuser`（獨立 platform JWT）、租戶管理頁已存在（`admin/tenants`），本 change 在既有機制上延伸。

## Goals / Non-Goals

**Goals:**
- `Tenant` 可記錄合約起訖日（`contractStartDate` / `contractEndDate`），平台 superuser 可在後台設定與查看。
- 純記錄語意明確：不做自動停用、不做提醒、不影響權限/計費/登入。
- 對既有租戶零影響（欄位 nullable、無 default）。
- 確認既有 `trial.durationDays`（試用天數）在平台後台呈現完整，讓「租戶期間管理」集中可見。

**Non-Goals:**
- **不做**合約到期自動停用/降級/提醒（明確區隔於 trialEndsAt 的自動化；若日後要，另開 change）。
- **不改動** trial 機制的任何行為（durationDays / trialEndsAt / scheduler 一律不動）。
- 不接金流、不做合約金額/條款管理（僅日期）。
- 不做租戶端（tenant 使用者）可見——合約日期是平台方內部管理欄位。

## Decisions

### 1. 兩個獨立 nullable 欄位，而非 JSON 或關聯表
`contractStartDate DateTime?` + `contractEndDate DateTime?` 直接加在 `Tenant`。
- 為何不用 `limitOverrides` 那種 JSON：合約日期是結構化、需查詢/排序（未來續約報表會 `WHERE contractEndDate < X`），獨立欄位比 JSON 好查。
- 為何不用獨立 `Contract` 表：目前只需「一租戶一組起訖日」，無多合約/歷史需求；過度設計。日後若需合約歷史再抽表。

### 2. 純記錄——不掛任何 scheduler / 自動行為
合約日期**只被讀寫**，不進任何排程掃描。與 trial scheduler（掃 `trialEndsAt` 自動停用）完全分離。
- 明確寫進 spec 的 MUST NOT，避免未來誤加自動停用把付費租戶意外停權。

### 3. 日期驗證：起訖合理性 + 允許 null
- 兩者皆 optional（可只設一個或都不設）。
- 若兩者都有值，`contractEndDate` MUST >= `contractStartDate`（Zod refine），否則 422。
- 存 `DateTime`（date 精度即可，存當日 00:00 UTC 或用 date-only 慣例——比照 `trialEndsAt` 的 DateTime 存法，前端傳 ISO date）。

### 4. API：複用平台租戶管理端點，加 PATCH
在既有平台租戶服務加「更新合約日期」——`PATCH /api/v1/platform/tenants/:id/contract`（或併入既有租戶 update 端點，看現有 trial-admin/platform-tenant 慣例）。受 `authenticatePlatformSuperuser` 保護、寫 `PlatformAuditLog`（比照其他平台變更操作）。租戶列表回傳一併帶 `contractStartDate/EndDate` 供顯示。

### 5. trial.durationDays 只確認、不改
既有機制（PlatformSetting `trial.durationDays` → 開通算 `trialEndsAt`）行為不動。本 change 僅在 spec 記錄「平台後台可設試用天數」這個確認性 requirement + 確保 UI 有呈現（現況 `admin/plans` 或試用政策頁若已有則僅驗證）。

## Risks / Trade-offs

- **語意混淆風險**：合約日期與 trialEndsAt 都是「租戶的期間」，開發者可能誤把合約日期也接進 scheduler → 意外停用付費租戶。緩解：spec 明列 MUST NOT、design 強調界線、欄位命名清楚（contract* vs trial*）。
- **date vs datetime 精度**：合約通常是「日」粒度，用 DateTime 存會有時區/時分秒雜訊。緩解：比照 trialEndsAt 現有慣例存 DateTime，前端顯示只取日期部分；若未來要嚴格 date-only 再調。
- **無合約到期行為 = 需人工追蹤**：純記錄代表沒有自動續約提醒，營運要自己看。這是本 change 的刻意取捨（Non-Goal），符合「先只要記錄」的需求；日後可另開 change 加提醒 scheduler（可複用 trial scheduler 的 fan-out pattern）。
- **審計**：合約日期是商業敏感資訊，變更應寫 PlatformAuditLog（已納入 Decision 4）。
