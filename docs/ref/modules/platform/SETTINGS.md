# 平台設定與權限註冊表

平台層的 KV 設定，以及提供給後台介面的功能與渠道類型清單。兩者都由 `platform.routes.ts` 直接提供。

- **資料來源**：`apps/api/src/modules/platform/platform-setting.service.ts`、`platform.routes.ts`、`packages/core/src/rbac/`
- **核對日期**：2026-09-23

## KV 設定

`PlatformSetting` 以 `key` 為主鍵，`value` 是任意 JSON。只有兩個端點：`GET /settings/:key` 讀一個鍵，`PUT /settings/:key` 寫一個鍵（upsert）。

三件事要知道：

- **沒有鍵的白名單，也沒有值的 schema。** `PUT` 的 Zod 只寫 `z.unknown()`，任何鍵、任何型別都寫得進去。打錯鍵名不會報錯，只是永遠沒有人讀它。
- **讀取端自己做型別檢查，不符就靜默退回預設值。** `getTrialPolicy()` 逐個欄位檢查型別，例如 `trial.durationDays` 被寫成字串 `"30"` 時，型別檢查不過，改用程式預設的 14，而且不會有任何錯誤訊息。設定看起來存進去了，行為卻沒變。
- **沒有快取。** 每次讀都直接查資料庫，改完立刻生效。這一點與方案相關的快取不同，見[平台後台](./README.md#方案異動的連鎖效果)。

## 目前有哪些鍵

只有試用政策在用這張表，六個 `trial.*` 鍵，預設值在 `apps/api/src/modules/trial/trial-policy.service.ts` 的 `DEFAULTS`，各鍵的作用見[試用管理](./TRIALS.md#政策參數)。

維護介面是 `/admin/trial` 的「設定」分頁，不是獨立頁面。**該分頁只列出其中五個鍵，`trial.planSlug` 不在裡面**，要改只能直接打 `PUT /settings/trial.planSlug`。

`PUT` 會寫一筆 `setting.update` 稽核，但**只記鍵名，不記新舊值**（呼叫時沒有傳 `payload`）。稽核紀錄能回答「誰在什麼時候改過哪個設定」，不能回答「改成什麼」。

## 權限註冊表

`GET /registry` 是方案設定頁的資料來源，讓前端不必寫死功能清單。它不讀資料庫，回傳兩份清單：

| 欄位 | 來源 | 內容 |
| --- | --- | --- |
| `features` | `buildPlatformRegistry()`，`packages/core/src/rbac/` | 每個 feature 的 slug、中文標籤、說明、是否為 `core`，以及它涵蓋的權限碼與標籤 |
| `channelTypes` | Prisma 的 `ChannelType` enum | 所有渠道類型的值 |

兩份清單都是算出來的，不是另一份設定：

- 在 `packages/core/src/rbac/features.ts` 加一個 feature，或在 `permissions.ts` 加一個權限碼，方案設定頁就會多出對應的選項。
- 在 schema 加一個 `ChannelType`，渠道白名單的選項就會自己出現。

這是「單一真實來源」的作法：權限與渠道類型只定義一次，平台後台跟著長出來。前端因此不會出現「程式已經支援、但方案頁選不到」的落差。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
