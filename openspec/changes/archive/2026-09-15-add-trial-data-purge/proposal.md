## Why

平台後台的試用政策已有「到期後資料保留天數」（`trial.dataRetentionDays`）欄位，但目前**只儲存、無任何邏輯使用**——設了不生效，對平台方有誤導（以為到期一段時間後資料會被清，實際不會）。trial-lifecycle 規格當初即註明「清除屬後續 change，dataRetentionDays 僅先儲存」。本 change 補上這個「後續 change」：試用租戶停用後，超過保留天數即以**軟刪（標記，不真刪 DB）** 方式清除，讓該欄位真正生效，同時保留可復原性。

## What Changes

- `Tenant` 新增 `purgedAt DateTime?`（軟刪時間戳，null = 未清除）；軟刪為「標記」，MUST NOT 真的 DELETE 任何資料列。
- trial scheduler 新增「到期後保留期屆滿即軟刪」邏輯：對「已停用（`isActive=false`）、`trialEndsAt` 已過超過 `dataRetentionDays` 天、且 `purgedAt` 為 null」的試用租戶，設 `purgedAt = now`，寫 `PlatformAuditLog`。
- 軟刪語意明確：已軟刪（`purgedAt` 非 null）的租戶 MUST 與停用一樣無法登入/收訊，且 MUST 可由平台方查看與「復原」（清 `purgedAt`）。
- 平台後台可見租戶的軟刪狀態，並提供「復原」操作（清 `purgedAt`）。
- 前端「資料保留天數」欄位維持可設，此 change 後其值真正生效。

## Capabilities

### New Capabilities
- `trial-data-purge`: 試用租戶到期後保留期屆滿的軟刪（標記清除）與復原機制。

### Modified Capabilities
- `trial-lifecycle`: 補上「保留期屆滿軟刪」requirement（原規格只寫「dataRetentionDays 僅先儲存、清除屬後續 change」，本 change 落實該後續行為）。

## Impact

- **Schema / DB**：`Tenant` 加 `purgedAt DateTime?`；新增 migration（nullable、無 default、非破壞性）。
- **後端**：`trial.scheduler.ts` 加軟刪掃描（比照現有到期停用的 fan-out）；平台租戶管理 service 加「復原」；平台路由加復原端點。
- **前端**：平台後台租戶/試用管理顯示軟刪狀態 + 復原按鈕。
- **無破壞性**：純新增；軟刪不刪任何資料、可復原。既有租戶 `purgedAt` 為 null 不受影響。
- **明確非目標**：不做硬刪（真 DELETE）——若日後需真正清除 DB 空間，另開 change 並加更強防呆。
