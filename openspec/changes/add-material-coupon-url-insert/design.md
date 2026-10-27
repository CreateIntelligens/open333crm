## Context

- 附券廣播的代入在 `apps/api/src/modules/marketing/broadcast-coupon.flow.ts` 的 `buildRecipientMessages()`：用 `renderTemplateBody()` 遞迴替換素材 body 中**所有字串欄位**的 `{{coupon.url}}`。`broadcast-coupon.service.ts` 用 `extractVariables()` 判斷素材有沒有放這個佔位字，沒放就在素材後另送發券文字。
- 一般廣播與關鍵字回覆不提供 `coupon.url` 的值，`replaceInString()` 遇到沒有值的佔位字會原樣保留，所以顧客會看到 `{{coupon.url}}` 字面。這是說明文字要提醒的原因。
- 後端變數清單已有 `{ key: 'coupon.url', label: '票券連結（僅附券廣播）' }`（`template-context.ts`）。

## Goals / Non-Goals

**Goals**

- 商家不必記佔位字，在文字素材一鍵插入。
- 插入位置、焦點、字數上限的行為明確且可測。

**Non-Goals**

- 不在素材綁定特定優惠券（使用者已選「通用連結」方案）。
- 不改後端代入、遮罩或驗證邏輯，不需要資料庫 migration。
- 不處理按鈕網址欄位（見下方涵蓋範圍）。

## Decisions

### 涵蓋範圍：只做 LINE 純文字與 FB 純文字

`renderTemplateBody()` 會替換所有字串欄位，所以技術上任何欄位都會代入。逐一評估有自由文字欄位的版型：

| 版型 | 文字欄位 | 決定 | 理由 |
| ---- | -------- | ---- | ---- |
| `line_text` | 訊息內容 | 涵蓋 | LINE 文字訊息會把網址變成可點連結 |
| `fb_text` | 訊息內容 | 涵蓋 | Messenger 文字訊息會把網址變成可點連結 |
| `fb_button` | 主要訊息 | 不涵蓋 | 按鈕範本的文字不會變成可點連結，顧客只能複製長網址；券連結應放在按鈕網址 |
| `line_carousel`、`line_flex_showcase` | 卡片標題、說明、按鈕文字 | 不涵蓋 | 卡片文字不會變成可點連結；按鈕網址欄位存檔時要經過 LINE validate，`{{coupon.url}}` 不是合法網址會被退 |
| `line_imagemap`、`line_video`、圖片類、`fb_generic`、`fb_media`、`fb_coupon`、`fb_receipt`、`fb_feedback` | 無自由長文字或只有網址欄位 | 不涵蓋 | 同上 |

按鈕網址欄位放券連結是另一個需求（要先處理 LINE validate 對佔位字網址的檢核），不在這次範圍。

### 共用元件 `CouponUrlTextField`

`LineTextEditor` 與 `FbTextEditor` 的文字欄位只差字數上限，抽成一個元件：textarea、字數計數、「插入券連結」按鈕、說明文字、超過上限的提示都在裡面。編輯器的 props 介面不變，`MaterialEditor` 不用改。

### 「沒有游標」的判斷

點按鈕時 textarea 已失去焦點，但瀏覽器仍保留 `selectionStart`。從沒進過輸入框時，`selectionStart` 是瀏覽器的預設值（可能是 0），插在開頭不符合預期。元件用一個 ref 記錄 textarea 是否曾取得焦點：

- 曾取得焦點：用 `selectionStart`／`selectionEnd`，有選取文字時取代選取範圍。
- 從未取得焦點：加在結尾。

插入後在下一次繪製前（`useLayoutEffect`）把焦點移回 textarea，並把游標設在插入文字之後。

### 字數上限

插入後長度 = 原長度 − 選取長度 + 佔位字長度。超過上限時不改內容，在欄位下方顯示 `role="alert"` 的提示，說明還差多少字；內容再變動時清掉提示。

## 個資遮罩查證

素材存檔時若租戶啟用個資遮罩（`privacyMode === 'mask'`），`prepareStoredMaterialBody()` 會把 body 每個文字欄位（含 `text`）整段送到外部去識別化服務（`https://2md.aiurl.tw/api/deid`，`mode: 'label'`），存回服務傳回的文字。程式本身沒有特別保護 `{{...}}`。

2026-10-27 用不含個資的樣本實際呼叫該服務：`{{coupon.url}}`、`王小明 請點 {{coupon.url}} 領取`、`網址：{{coupon.url}}`、`{{contact.name}}`、`Hi {{contact.email}} see {{coupon.url}}`、`領券請點 {{coupon.url}} ，{{contact.name}} 您好，電話 0912345678`。所有佔位字都原樣保留，只有真正的姓名、手機被換成 `[姓名]`、`[手機]`。

結論：目前遮罩不會改動或誤判 `{{coupon.url}}`，這次不修改遮罩程式。風險是這個保證來自外部服務的現行行為，不是程式的契約；若服務日後改變判斷，佔位字可能被改掉而沒有錯誤。可選的加固做法（未在這次實作）：在 `maskStructuredContent()` 送出前把佔位字切出，只遮罩其餘片段再組回。

## Risks / Trade-offs

- 說明文字提醒「一般廣播、關鍵字回覆不會替換」，但不阻止商家把含佔位字的素材用在那些地方。阻擋要改到廣播與自動化的選素材流程，不在這次範圍。
