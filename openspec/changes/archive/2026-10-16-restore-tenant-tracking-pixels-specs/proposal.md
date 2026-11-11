## Why

change `add-tenant-tracking-pixels` 在 `aa274cf0` 以改名的方式搬進 `archive/`（issue #228），它的 delta spec 從來沒有套用。之後 change `fix-admin-settings-safeguards` 歸檔時建立了主規格 `tracking-settings`，但這份主規格只規定 ID 的格式。追蹤設定的讀寫與權限，以及短連結中轉頁放入追蹤碼，都沒有主規格。

程式已經實作這些行為，但只有格式驗證有測試。這個 change 照現行程式補上需求與測試。

## What Changes

- `tracking-settings` 新增 2 條需求：
  - 讀取追蹤設定。
  - 更新追蹤設定。
- `shortlink-ua-strategy` 新增 1 條需求：中轉頁放入租戶的追蹤碼。
- 新增測試 `apps/api/tests/feature/modules/shortlink/shortlink-tracking-injection.test.ts`。在 `apps/api/tests/feature/modules/settings/tracking-settings-route.test.ts` 加入讀取、更新、權限與稽核的測試。
- `docs/ref/features/tenant/SETTINGS.md`、`SHORTLINKS.md`：
  - 改正「先載入追蹤碼再轉址」的描述。
  - 補上 GA ID 只接受大寫。
  - 補上 LIFF 中轉頁也放入追蹤碼。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| Tenant admin can set GA4 Measurement ID、Tenant admin can set Meta Pixel ID | 合併成「更新追蹤設定」。歸檔規格沒有規定沒送的欄位怎麼處理，需求照現行程式寫：`PUT` 同時取代兩個欄位，沒送的欄位存成 `null` |
| Tracking settings are retrievable | 改寫成「讀取追蹤設定」 |
| Non-admin users cannot modify tracking settings | 歸檔規格以角色（ADMIN、SUPERVISOR、AGENT）判斷。現行程式要求權限碼 `settings.manage`，讀取也要。權限的部分寫進「讀取追蹤設定」與「更新追蹤設定」 |
| Frontend provides tracking settings form | **不補。** 後台表單不寫進規格。歸檔規格寫的設定頁分頁列已經改成側邊選單 |
| External browser strategy injects GA4 script、External browser strategy injects Meta Pixel script、FB WebView strategy injects tracking scripts、LINE WebView strategy injects tracking scripts | 合併成 `shortlink-ua-strategy` 的「中轉頁放入租戶的追蹤碼」，不另建主規格 `shortlink-tracking-injection`。歸檔規格要求另外呼叫 `gtag('event', 'page_view')`，現行程式只呼叫 `gtag('config', …)`。`config` 預設會送出 page_view，再呼叫一次會重複計算，所以需求照現行程式寫 |
| BOT strategy does NOT inject tracking scripts | **不補。** `shortlink-ua-strategy` 的「Bot requests receive an OG preview without tracking」已經涵蓋 |
| Tracking scripts do not block redirect | 不補執行順序。需求只寫「中轉頁不等追蹤事件送出就轉址」，原因見下一節 |
| Cache headers prevent stale tracking | **不補。** `shortlink-ua-strategy` 的 BOT 與一般瀏覽器需求已經規定 `Cache-Control: no-store`。LIFF 的需求沒有寫，但程式的 LIFF 中轉頁也使用同一組 no-store 標頭 |

### 追蹤事件不保證送出

中轉頁放入追蹤碼之後，立刻呼叫 `window.location.replace()`，不等 gtag.js 與 fbevents.js 下載完成。2026-10-16 用 headless Chromium 實測，每次都用新的瀏覽器 context：

| 目標網址 | GA 事件送出 | Pixel 事件送出 | `/s/track` 送達 |
| --- | --- | --- | --- |
| 本機頁面（回應很快） | 0/10 | 0/10 | 10/10 |
| `https://example.com/` | 10/10 | 9/10 | 10/10 |

Daniel 決定維持現狀，不改成等事件送出再轉址，因為等待會讓每次點短連結都變慢。所以需求寫明「GA 與 Meta 不一定收到事件」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tracking-settings`：新增追蹤設定的讀取與更新。
- `shortlink-ua-strategy`：新增中轉頁放入租戶的追蹤碼。

## Impact

- `openspec/specs/tracking-settings/spec.md`、`openspec/specs/shortlink-ua-strategy/spec.md`（歸檔時修改）
- `apps/api/tests/feature/modules/shortlink/shortlink-tracking-injection.test.ts`（新增）
- `apps/api/tests/feature/modules/settings/tracking-settings-route.test.ts`
- `docs/ref/features/tenant/SETTINGS.md`、`docs/ref/features/tenant/SHORTLINKS.md`
