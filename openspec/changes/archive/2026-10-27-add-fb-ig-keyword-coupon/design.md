## Context

「關鍵字回覆」是 `trigger.type = 'keyword.matched'` 的自動化規則，頁面只管理「傳送素材」「發送優惠券」兩個動作與關鍵字，
儲存時保留規則上其他的動作與條件（add-coupon-system design D25）。目前頁面固定加上「對話渠道等於 LINE」，
素材只列 LINE 素材；素材不是 LINE 素材的規則擋下存檔並引導到自動化規則編輯（PR #364 第二輪審查）。

自動化規則編輯器不提供發券動作，所以 FB 與 Instagram 沒有地方設定關鍵字發券。後端與 workers 本來就與渠道無關，見下方查證。

## FB／IG 端到端查證（讀程式確認，本 change 不改後端）

| 步驟 | 程式 | FB／Instagram 的行為 |
| ---- | ---- | -------------------- |
| 收到訊息 | `apps/api/src/modules/webhook/inbound-side-effects.ts` 發出 `message.received`；`automation.worker.ts` 對所有渠道 enqueue `message.received`（帶 `channelType`，FB／IG 沒有 `replyToken`） | 與 LINE 相同 |
| 比對關鍵字 | `apps/workers/src/handlers/automation.handler.ts` `evaluateKeywordRules` 對所有渠道比對 | 與 LINE 相同 |
| 評估條件 | `packages/automation/src/automation-facts.ts`：`conversation.channelType` 為對話渠道的 `channelType`（`FB`、`THREADS`） | 條件「對話渠道等於 FB／THREADS」成立；等於 LINE 不成立 |
| AI 讓步 | `apps/api/src/modules/automation/keyword-yield.ts`：`AUTOMATION_DELIVERY_CHANNEL_TYPES` 含 `FB`、`THREADS`；`issue_coupon` 的券是進行中就讓步 | 規則會發券時 AI 不另外回覆 |
| 發券 | `apps/workers/src/lib/rule-coupon-issue.ts`：渠道在 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 內、聯絡人有這個渠道的身分才保留券 | 照常保留、送出、確認；送不出時作廢並歸還名額 |
| 票券連結 | `couponLiffConfig` 只讀 LINE 渠道設定的 LIFF；FB／IG 回 null，連結為一般網址 | 顧客開啟後以 email 驗證碼歸戶（coupon-redemption「顧客須完成歸戶驗證才能開啟票券夾」），票券頁顯示「回到 Messenger」或「回到 Instagram」 |
| 送出方式 | `apps/workers/src/lib/channel-delivery.ts`：`selectSafeLineStrategy` 只用於 LINE；FB／IG 沒有回覆權杖，策略為 `push` | `fbPlugin`／`threadsPlugin.sendMessage` 以 Send API 送純文字（`message.text`），沒有帶 `messaging_type`，Meta 預設為 `RESPONSE` |
| 24 小時視窗 | 外掛宣告 `messagingWindowHours = 24`；workers 送出前不檢查 | 關鍵字由顧客剛傳來的訊息觸發，一定在視窗內。佇列延遲超過 24 小時的極端情況下 Meta 拒收，走「送不出」：券作廢、名額歸還、對話留下紅色的送出失敗紀錄（不是只寫 log） |
| 發不出時回覆顧客 | `rule-coupon-issue.ts` 的 `fail()` 以 `deliverToChannelFromWorker` 送文字 | 與 LINE 相同，只是用 push；渠道拒收、沒有渠道身分時不回覆 |
| workers 外掛 | `apps/workers/src/lib/plugin-registry.ts` 註冊 `linePlugin`、`fbPlugin`、`threadsPlugin` | 已註冊 |

結論：FB 與 Instagram 觸發 `issue_coupon` 時端到端發得出去，缺的只有設定入口。本 change 在 workers 補測試（FB 與 Instagram 各一條發券、
FB 的發不出時回覆），以突變驗證（從 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 拿掉 `FB`／`THREADS` 時測試失敗）。

## Goals / Non-Goals

**Goals**

- 關鍵字回覆可以為 LINE、Facebook、Instagram 建立，規則只在所選渠道觸發。
- 既有 LINE 規則的條件、素材、啟用狀態完全不變；編輯時仍保留 LINE 條件。
- 列表看得出每條規則的渠道；素材與渠道不符時擋下存檔並說明。
- 修正啟用開關與存檔後畫面沒有更新的 bug。

**Non-Goals**

- 綁定到特定渠道帳號（例如同租戶兩個粉專只對其中一個生效），見 D3。
- Instagram 素材：素材庫目前只允許 `line`、`fb`（`material.service.ts` `ALLOWED_CHANNEL_TYPES`），新增 Instagram 素材另開 change。
- 網站客服：workers 沒有網站客服的外掛（AUDIT CHAN-02），不列入可選渠道。
- 搬移網址：維持 `/dashboard/line/keyword-replies`，見 D1。

## Decisions

### D1 頁面位置與命名：同一頁改名「關鍵字回覆」，頁內分渠道

側欄「渠道」底下的「LINE 關鍵字回覆」改名為「關鍵字回覆」，頁首標題為「關鍵字回覆」，說明改寫為 LINE、Facebook、Instagram 共用。
列表上方加渠道篩選（全部、LINE、Facebook、Instagram），並多一欄「渠道」。

- **為何不另開 FB／IG 頁**：三頁的表單、列表與防線完全相同，另開頁面要複製三份；商家也比較容易在一頁看到所有關鍵字，
  避免同一個關鍵字在不同頁面各自設定卻不知道。
- **為何不換網址**：操作手冊（ch10）、E2E 測試與書籤都連到 `/dashboard/line/keyword-replies`。網址裡的 `line` 只是歷史路徑，
  畫面上不再出現「LINE 關鍵字回覆」。要整理網址時另開 change 並加轉址。
- 「LINE 加好友禮」「LINE 快速回覆」只適用 LINE，名稱不變。

### D2 規則的渠道 = 條件中的「對話渠道等於 X」

- 頁面從規則的頂層 `all` 讀出 `conversation.channelType` 的 `equal` 條件：值為 `LINE`、`FB`、`THREADS` 時就是規則的渠道。
- 沒有任何 `conversation.channelType` 條件 → 「未限定渠道」（在一般自動化規則建立的規則，所有渠道都會觸發）。
- 有 `conversation.channelType` 條件但不是上述三者之一的單一 `equal`（例如等於 `WEBCHAT`、`notEqual`、`in`、兩個互相矛盾的條件）
  → 這頁無法辨識，擋下存檔並引導到自動化規則編輯；列表標示「渠道條件請到自動化規則編輯」。這頁加上條件會讓規則永遠不成立，所以不能存。
- 儲存時：規則已有所選渠道的條件就不重複加；沒有就加上（`all` 群組追加；`any` 群組時包成 `{ all: [渠道條件, 原群組] }`，與現在相同）。
- 值用 `THREADS`（本專案 Instagram 私訊的渠道類型），畫面一律顯示「Instagram」。

### D3 綁定渠道類型，不綁定特定渠道 id

同租戶有多個 LINE 官方帳號或多個粉專時，規則對同一渠道類型的所有帳號生效——與現在「規則對所有 LINE 官方帳號生效」相同。

- 素材以渠道類型區分（`material.channelType`），券是租戶層級，兩者都不分帳號，綁定渠道類型與既有資料一致。
- 綁定特定渠道 id 需要新的條件事實（例如 `conversation.channelId`）：`packages/automation` 的契約與 `buildAutomationFacts`、
  workers 與 API 的 AI 讓步都要支援，另開 change。頁面說明寫清楚「對這個渠道類型的所有帳號生效」。
- **需要使用者決定**：是否有客戶需要「只對某個粉專」生效。有的話以 `conversation.channelId` 條件另開 change。

### D4 渠道在建立後不能更改；未限定渠道的舊規則可以選

- 新建：選 LINE、Facebook、Instagram，預設為列表目前篩選的渠道（「全部」時為 LINE）。
- 編輯已有渠道條件的規則：顯示渠道、不能更改。改渠道要移除舊條件，也會讓原本的素材失效；需要時刪除後重建。
- 編輯未限定渠道的規則：預設為素材的渠道（LINE 或 Facebook 素材），沒有素材時為 LINE——與目前「一律加 LINE 條件」相同，
  既有 LINE 素材的規則行為不變。可以改選，表單說明「這條規則原本沒有限定渠道，儲存後只在所選渠道的對話觸發」。
  以前傳送 Facebook 素材而被擋下的未限定渠道規則，現在預設為 Facebook，可以在這頁儲存。

### D5 素材防線改為依規則的渠道

- 素材選單只列所選渠道的啟用中素材；Instagram 沒有素材，選單停用並說明「Instagram 目前沒有素材，只能發券」。切換渠道時清掉不屬於新渠道的素材選擇（原本的素材保留，由下一點的防線說明）。
- 規則原本的素材在儲存時沒有改選，而且：素材不是所選渠道的、已刪除、已停用或讀不到 → 擋下存檔並顯示原因（訊息改為
  「這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯」）。改選素材或拿掉素材只發券即可儲存。
- 頁面擋一次、`updateKeywordReply` 再擋一次（現有做法），任何呼叫端都不會把不符的規則加上條件而靜默失效。
- 列表素材欄依規則的渠道判斷；未限定渠道的規則依 D4 的預設渠道判斷。

### D6 修正啟用狀態與存檔後畫面沒更新

原因：`useKeywordReplies` 用兩層 SWR——規則列表（key 為 `/automation/rules?trigger=keyword.matched`）與規則明細
（key 為 `['keyword-reply-details', ids]`）。畫面上的 `isActive`、關鍵字、動作來自明細；切換或存檔後頁面只重新載入列表，
規則 id 沒變，明細的 key 不變，SWR 回傳快取，畫面停在舊值。

修正：hook 回傳的 `mutate` 同時重新載入列表與明細；另外 `isActive`、名稱與觸發設定以列表的最新值為準（列表本來就回這些欄位）。

### D7 自動化規則編輯器的「對話渠道」加上 Instagram

`AUTOMATION_FACT_DEFINITIONS` 的 `conversation.channelType` 選項只有 LINE、Facebook、WebChat；Instagram 關鍵字回覆在編輯器裡會顯示成空白。
加上 `{ value: 'THREADS', label: 'Instagram' }`。只影響編輯器的選項，契約驗證本來就不限制值。
同一組選項也用在「聯絡人渠道」條件，聯絡人本來就可能有 Instagram 的渠道身分，一併列出。

### D8 廣播選到 Instagram 時說明只能附券

查證後端：`apps/api/src/modules/marketing/marketing.routes.ts` 的 `createBroadcastSchema` 規定沒有附券時素材與舊版型要擇一，
「Instagram ＋ 沒有素材 ＋ 沒有附券」回 400「素材與版型請擇一提供，不可同時或都不填」；附券時素材可以不選，只送預設的發券文字。
附券廣播由 API 以 `getChannelPlugin` 送出，`threadsPlugin` 已在 API 註冊，並依 `messagingWindowHours = 24` 略過視窗外的人。

素材庫沒有 Instagram 素材，前端原本顯示空白的素材選單、建立按鈕灰掉卻沒有說明。改為：

- 選到 Instagram 時，素材欄位改為說明「Instagram 沒有可用的素材，只能附上優惠券、送出預設的發券文字；只會送給 24 小時內傳過訊息給 IG 帳號的人」。
- 沒有素材也沒有附券時，建立按鈕停用並在按鈕上方說明原因（Instagram 為「Instagram 廣播要附上優惠券才能建立」，其他渠道為「請選擇素材或附上優惠券」），與後端規則一致。
- 建立廣播與券詳情頁「發送給…」的渠道選單改為「名稱（LINE／Facebook／Instagram）」，不顯示 THREADS、FB。
- 後端不改。

## Risks / Trade-offs

- **未限定渠道且傳送 Facebook 素材又發券的舊規則**：目前在 LINE 對話也會發券；在這頁儲存後只在 Facebook 觸發。表單會明確說明，由管理員決定。
- **同租戶多帳號**：規則對同類型所有帳號生效（D3），若某粉專不該發券，目前只能在自動化規則編輯器另加條件（例如聯絡人標籤）。
- **網址仍含 `line`**：使用者看不到，但開發者閱讀時可能誤會；在 page.tsx 註解說明。

## Migration Plan

不需要資料遷移，也不需要 migration。既有規則的條件、素材、啟用狀態不變；只有管理員在這頁編輯儲存未限定渠道的規則時才加上渠道條件（D4）。
