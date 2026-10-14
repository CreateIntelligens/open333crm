## Why

email One ID（`email-identity-merge`）上線後，老闆希望改用手機號碼當 One ID：台灣顧客對手機號碼比 email 熟，店家既有的顧客資料（客服登記、匯入）也多半只有電話。2026-10-14 使用者決定：不做 OTP 驗證，比照 email 版，相同號碼直接自動合併（方案 A）。

## What Changes

- 新增「手機登記」：與 email 登記並存、各自啟用。顧客在對話輸入關鍵字（預設「登記手機」）或客服代發，取得一次性登記連結，在登記頁填入手機號碼。
- 只接受台灣手機號碼，`0912-345-678`、`+886 912 345 678` 等格式統一存成 `0912345678`。
- 同租戶另一位未封存聯絡人的電話（統一格式後）相同時，不經人工確認直接合併到最早的那一位；沒有就只寫入電話。比對既有電話時也統一格式，客服或匯入存的 `0912-345-678` 也算相同。
- 沿用 email 版的保護：同渠道衝突拒絕合併、雙邊通知、7 天內自助解除、公開端點限頻、同號碼依序處理。
- email 與手機可以同時開啟。相同的值要合併時，兩位聯絡人的另一種識別（手機登記時看 email、email 登記時看手機）都有值且不同，就不自動合併，回覆顧客需要客服確認。避免共用號碼的家人、或兩組已各自歸戶的資料被連鎖併成一位，也避免合併後只留一個 email／電話、另一個比對不到。**email 登記也套用**（修改 `email-identity-merge`）。
- 手機號碼比 email 容易取得與猜測，登記方收到的整合通知**不顯示對方的名稱**，只顯示渠道，避免輸入號碼就能查出號碼主人。
- 設定頁新增手機登記開關與關鍵字；收件匣新增「傳送手機登記連結」。

## Capabilities

### New Capabilities

- `phone-identity-merge`：顧客以手機號碼登記，相同號碼自動歸戶。

### Modified Capabilities

- `email-identity-merge`：修改「相同 email 自動合併」，新增「手機號碼不一致時不自動合併」。

## Impact

- API：`apps/api/src/modules/identity-binding/`（登記流程抽出共用核心，email 與手機各一份設定）、`contact.routes.ts`（代發端點、狀態端點）、`settings.routes.ts`（開關與關鍵字）、`index.ts`（公開路由）、`log-redact.ts`、`contact-merge.service.ts`（合併來源 `PHONE`）
- Web：`/bind/phone/[token]` 登記頁、設定頁、收件匣代發按鈕、合併紀錄來源標籤
- 資料庫：不需要 migration。合併來源是字串欄位，`IdentityMap.source` 已有 `PHONE_MATCH`
- 預設關閉，由租戶管理員開啟
