## Why

LINE Account Link 原本寫在主規格 `line-account-link`，但系統從來沒有實作這項功能：

- 沒有簽發 link token 的路由。
- LINE 外掛會把 `accountLink` 事件解析出來，但 API 與 workers 都不處理這個事件。

主規格描述沒有實作的功能，讀者會以為功能已經上線。`docs/ref/system/AUDIT.md` 的「違反主規格的項目至少是 P2」也會因此誤判。issue #217 決定把這份主規格移回 change，保留為規劃。PR #224 移除了主規格，它的需求原封不動改為這個 change 的 ADDED delta spec。

## What Changes

- 新增 `line-account-link` 能力：簽發 Account Link 權杖，並在收到 `accountLink` webhook 時完成連結。
- 這項功能目前沒有排程，這個 change 不修改程式。

## Capabilities

### New Capabilities

- `line-account-link`：簽發 Account Link 權杖；收到 `accountLink` webhook 時完成連結，把 LINE 使用者與企業的會員帳號對應起來。

## Impact

可能用到 Account Link 的兩項工作：

- 跨渠道 One ID：`add-cross-channel-one-id` 移除了 `POST /api/v1/fan/auth`，粉絲門戶的受保護路由要等 Account Link 或會員登入頁接上（該 change 的任務 9.3.3）。
- 優惠券：`feat/coupon-system` 分支的 `add-coupon-system` 計劃在第一階段以 Account Link 驗證顧客身分。

排程時要做的事：

- 依 `openspec/config.yaml` 的規則補上失敗與邊界情境，例如 nonce 過期、nonce 屬於其他租戶、LINE 重送同一個 `accountLink` 事件。
- 補上 `design.md` 與 `tasks.md`。
- 如果 `add-coupon-system` 先合併，而且它的需求已經涵蓋 Account Link，就刪除這個 change。
