## Why

`aa274cf0` 把 `add-instagram-channel` 搬進 `archive/`，沒有經過 `openspec archive`（issue #228）。這個 change 的 12 條需求都寫成 MODIFIED，但其中 11 條在主規格 `threads-channel` 裡沒有同名需求，所以沒有套用到主規格。

結果是 Instagram 私訊能正常運作的關鍵行為都沒有主規格：專屬的 webhook 路由、以 `appSecret` 驗簽、略過 echo 與已讀回條、以平台訊息 ID 去重、驗證渠道的權杖。主規格已有的需求也有兩條寫錯了：「Message Sending」寫圖片先上傳到 Instagram 的 Media Library，實際上是在訊息裡直接帶圖片 URL；「Profile Retrieval」的回傳欄位名稱與程式不同。

這些行為大多沒有測試。

## What Changes

逐條對照歸檔的需求與現行程式，以現行程式為準補回主規格，並為每個情境補上測試。程式沒有改動。

- `threads-channel`：
  - 改寫「Webhook Verification」：寫明每個渠道的 GET／POST 路由、驗證權杖不符回 403、渠道不存在回 404、POST 先回 200 再處理、以 `appSecret` 驗簽。
  - 改寫「Message Parsing」：寫明 `channelMsgId`，以及不產生訊息的 3 種事件。「Like (Heart) Reaction」原本寫「sticker 或 text」，程式固定是 `sticker`。
  - 改寫「Message Sending」：修正圖片的送法，補上 Graph API 回傳錯誤的情境。
  - 改寫「Profile Retrieval」：規格寫回傳 `username`、`name`、`profileImageUrl`，程式實際回傳 `uid`、`displayName`、`avatarUrl`。補上取得失敗時的行為。這條需求不在歸檔的 delta 裡，是 2026-03 寫主規格之後就沒有更新。
  - 新增「驗證 Instagram 渠道的權杖」「後台建立 Instagram 渠道」「後台顯示 Instagram 渠道的驗證權杖」「收件匣以 Instagram 顯示 IG 對話」。
- `inbound-message-processing`：新增「以平台訊息 ID 去重」。這個行為適用所有渠道，所以不放在 `threads-channel`。
- `automation-engine`：新增「非文字訊息不做 AI 自動回覆」。原因同上。
- `core-inbox`：新增「無法解析的訊息顯示佔位文字」。

沒有補回的部分：

- 「Threads Plugin Registration」：#278 已經改寫，涵蓋 API 與 workers 的註冊。
- 「Inbound image renders in the inbox」的圖片顯示：`core-inbox` 的「Inbox Shows Inbound Media」已經涵蓋。
- 聯絡人時間軸與工單詳情把 `THREADS` 顯示成「Instagram」、渠道標示的品牌色：屬於畫面呈現，沒有補。
- 「Create Instagram Channel from Admin UI」的「Inbound IG message triggers AI reply」：這是所有渠道共用的進站流程，不是 Instagram 的行為。
- Meta App 層級的 webhook 端點與 IG 專業帳號 ID：屬於 change `fix-meta-webhook-page-routing`，避免重複。

「後台顯示 Instagram 渠道的驗證權杖」的遮罩與合併規則其實適用所有渠道。目前沒有渠道管理的主規格，所以先寫在 `threads-channel`，範圍限定 Instagram 渠道。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `threads-channel`：改寫 4 條需求，新增 4 條。
- `inbound-message-processing`：新增「以平台訊息 ID 去重」。
- `automation-engine`：新增「非文字訊息不做 AI 自動回覆」。
- `core-inbox`：新增「無法解析的訊息顯示佔位文字」。

## Impact

- 測試：
  - `packages/channel-plugins/tests/unit/threads-plugin.test.ts`
  - `apps/api/tests/unit/modules/webhook/threads-webhook.test.ts`
  - `apps/api/tests/unit/modules/webhook/inbound-channel-msg-dedup.test.ts`
  - `apps/api/tests/unit/modules/channel/channel-instagram.test.ts`
  - `apps/api/tests/unit/modules/automation/non-text-no-ai-reply.test.ts`
  - `apps/web/tests/unit/components/inbox/instagram-inbox.test.tsx`
- 文件：`docs/ref/features/tenant/CHANNELS.md` 的限制表。#276 已讓 workers 註冊 Instagram 外掛，表上仍寫「workers 只註冊 LINE 與 FB 外掛」。
- 程式：沒有改動。
