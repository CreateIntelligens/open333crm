## Context

平台用量的每日趨勢與 AI 月額度原本都以 UTC 切日、切月，台灣時間 00:00–08:00 的用量算到前一天或上個月（健檢 HC-PLATFORM-USAGE-05、HC-PLATFORM-USAGE-09）。使用者決定兩者都改成台灣時間（`Asia/Taipei`，固定 UTC+8，沒有日光節約時間）。

## Decisions

### D1 每日趨勢在後端補 0，期間過濾不變

- SQL 以 `to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD')` 分組，寫法與券統計相同。
- 補日期用 `@open333crm/core` 的 `taipeiDatesBetween()`，券統計的 `fillDays()` 也改用它。超過 400 天只列有用量的日子。
- 總覽、排行與趨勢用同一組 `from`、`to` 時間點過濾，加總一致。前端「近 N 天」把 `from` 對齊台灣今天往前 N−1 天的 00:00，所以趨勢剛好 N 格。

### D2 月額度的月份全部改用台灣月份

月份只在 `apps/api/src/modules/trial/token-quota.service.ts` 計算，其他地方都從這裡取得：

| 位置 | 改成 |
| --- | --- |
| `monthKey()` | `taipeiMonthString(now)` |
| `monthStart()`：資料庫補建計數器的加總起點 | `taipeiMonthStart(now)`（台灣 1 日 00:00） |
| `nextMonthStart()`：計數器與告警旗標的 `PXAT` | `taipeiNextMonthStart(now)`（台灣下個月 1 日 00:00） |
| 計數器 key | `aiquota:{tenantId}:{YYYY-MM}:tpe` |
| 告警旗標 key | `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`，格式不變，月份改為台灣月份 |
| 告警事件的 `monthKey`，以及站內通知與 email 的「本月（YYYY-MM）」 | 來自 `checkQuotaThresholdCrossing()` 的 `monthKey()`，自動變成台灣月份 |
| `apps/api/verify-quota.mts`（手動驗證腳本） | 同上的計數器 key |

三個 helper 放在 `packages/core/src/coupon/taipei-time.ts`，與既有的 `taipeiDateString()` 同一處。

`git grep` 查過 `monthKey`、`startOfMonth`、`getUTCMonth`、`getMonth`、`aiquota`：workers 沒有自己算額度的月份。`notification.worker.ts`（在 api 內）只讀事件 payload 的 `monthKey`。`analytics.service.ts` 的「本月績效」以伺服器時區切月，屬於 ANA-01，不是月額度，不在這個 change 的範圍。

### D3 計數器 key 加上 `:tpe`，換版後從資料庫重建

舊計數器 `aiquota:{tenantId}:{YYYY-MM}` 從 UTC 1 日 00:00 起算，少了台灣 1 日 00:00–08:00 的用量。如果 key 不變，月中部署時新程式會沿用這個少算的計數器，直到月底。加上 `:tpe` 之後，新程式第一次讀取時找不到計數器，就以台灣月份從 `AiUsage` 重建（既有的 `SET NX` 補建路徑）。

部署當下的行為：

- **月中部署**：新程式重建的計數器等於台灣本月 1 日 00:00 起的加總，包含舊計數器漏掉的 8 小時。每一筆用量只在一個計數器裡，不重複計算。舊 key 沒有程式再讀，到原本的 UTC 月底自動過期。
- **台灣 1 日 00:00–08:00 部署**：舊程式在這段時間把用量累加到上個月的 UTC 計數器，但新程式不讀那個計數器。新程式以台灣新月份重建，這幾小時的用量依 `AiUsage.createdAt` 計入新月份，不漏算，也不會再算進上個月（上個月的計數器已經沒有人讀）。
- **告警旗標**：key 格式不變，月中部署時本月已寫入的旗標照樣有效，不會重發已發過的告警。重建後計數器變大，只有在本次累加真的從門檻以下跨到門檻以上時才告警（`before < 門檻 && after >= 門檻`）。台灣 1 日 00:00–08:00 部署時，舊程式寫的是上個月（UTC 月份）的旗標，新程式用新月份的旗標，兩者互不影響。舊旗標在 UTC 1 日 00:00（台灣 08:00）過期，新月份的旗標在台灣下個月 1 日 00:00 過期。
- **回滾**：舊程式讀回 `aiquota:{tenantId}:{YYYY-MM}`，這個 key 在新程式運作期間沒有累加，會少算新版期間的用量（不會多擋）。回滾時以 `clearTokenQuotaCache()` 或刪掉舊 key，讓舊程式從資料庫重建。

## Risks

- 月額度只依台灣時間，不讀 `TenantSettings.timezone`。目前所有租戶都在台灣；若之後有海外租戶，要另外決定。
