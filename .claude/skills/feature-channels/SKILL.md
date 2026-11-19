---
name: feature-channels
description: >
  open333CRM「渠道管理」功能顧問：LINE／FB／IG／WebChat 渠道的設定、Meta 連結、webhook 分派、權杖失效、渠道可見範圍、channel plugin registry。改到 channel 模組、webhook 路由、/dashboard/settings/channels，或新增渠道類型之前使用。
---

# 渠道管理

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。渠道的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

渠道（LINE、Facebook、Instagram 私訊 `THREADS`、網站聊天室 WebChat）的新增、編輯、停用、刪除、設定精靈、用 Facebook 連結粉專（meta-connect）、
憑證加密與遮罩、測試連線、webhook 網址與 Webhook 公開網址、FB／IG 的 `verifyToken`、Meta webhook 依粉專 ID 分派（`externalAccountId`、`webhookRouting`）、
權杖失效通知與重新連結（`tokenHealth`、`meta-token-health` 排程）、渠道可見範圍（`AgentChannelAccess`、`ChannelTeamAccess`、`read_only`／`reply_only`／`full`、`channel.view_all`）、
Bot 設定（botMode、`maxBotReplies`、轉接關鍵字、招呼語、LIFF ID）、網站聊天室的嵌入碼與背景、channel plugin registry。
相關的程式：`/dashboard/settings/channels`、channel 模組、webhook 路由、meta-connect 模組。
常見的問題描述：「渠道收不到訊息」「粉專訊息跑到別的租戶」「權杖失效」「分店看得到別店渠道」「新增一種渠道」。
改收件匣送訊息、自動化送訊息、人員管理的可用渠道之前也使用，確認不破壞渠道。

## 先讀

先讀功能文件 `docs/ref/features/tenant/CHANNELS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `CHANNELS.md` 的章節 |
| --- | --- |
| 找路由對應的 service 函式 | 程式的入口 |
| 新增渠道類型、外掛註冊 | 支援的渠道類型；`docs/ref/modules/CHANNEL-PLUGINS.md` |
| 建立渠道、方案限制、憑證欄位 | 新增渠道 |
| 進站 webhook、驗簽、FB／IG 帳號分派、測試連線、`externalAccountId` | Webhook |
| `Channel.settings` 的鍵、系統維護的鍵、憑證、Bot 設定 | 渠道設定 |
| 嵌入碼與聊天室外觀 | 網站聊天室 |
| 渠道授權、團隊授權 | 誰看得到這個渠道；單筆渠道路由的可見範圍 |
| 停用、刪除 | 停用與刪除 |
| 渠道管理頁的按鈕與表單 | 畫面怎麼呼叫 API |
| 權限碼 | 權限 |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的渠道測試在 `apps/api/tests/unit/modules/channel/`、`apps/api/tests/feature/modules/channel/`、`apps/web/tests/unit/components/settings/`、`apps/workers/tests/unit/lib/`、`packages/channel-plugins/tests/unit/`，寫法可以照著參考。

`CHANNELS.md` 裡標 `HC-CHANNELS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/CHANNELS.md`
- 規格：`openspec/specs/channel-management/spec.md`、`openspec/specs/channel-visibility-defaults/spec.md`、`openspec/specs/channel-team-access/spec.md`、`openspec/specs/threads-channel/spec.md`、`openspec/specs/channel-plugins/spec.md`、`openspec/specs/webchat-admin-theme/spec.md`
  - 可見範圍套用在對話與工單的規則在 `openspec/specs/channel-scoped-visibility/spec.md`（收件匣領域）。
  - Meta 依粉專分派的規格還在未歸檔的 change `openspec/changes/fix-meta-webhook-page-routing/`。
- 手冊：`apps/web/public/manual/ch15-channels.html`。手冊已把多個已知問題寫成注意事項。
- 影響分析：`node scripts/feature-impact.mjs --domain channels`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `CHANNELS.md` 括號內的章節。

- 兩個行程各有一份外掛註冊表。新增渠道或外掛時，API 的 `registerChannelPlugin()` 與 workers 的 `createWorkerPluginRegistry()` 都要加，`AUTOMATION_DELIVERY_CHANNEL_TYPES` 也要同步。（支援的渠道類型）
- 能主動推送的渠道只有一份清單 `PROACTIVE_PUSH_CHANNEL_TYPES`。網站聊天室外掛的 `sendMessage()` 只回成功，不要改成回失敗。（支援的渠道類型；`CHANNEL-PLUGINS.md`）
- 可見範圍是 fail-closed：沒有任何授權的渠道，只有 `channel.view_all` 的成員看得到；停用的渠道不在可見集合。不要加回「沒綁定等於全員可見」。（誰看得到這個渠道）
- 新渠道沒送 `visibleAgentIds` 時綁給所有啟用中的成員，送空陣列時誰都不綁。（新增渠道）
- 每條帶渠道 ID 的路由都掛 `requireVisibleChannel(level)`：讀取用 `read_only`，`channel.update`、`channel.delete` 用 `full`。看不到回 404，層級不足回 403。團隊授權路由例外。（單筆渠道路由的可見範圍）
- `externalAccountId` 只由驗證寫入，不可開放表單手填。否則共用同一個 Meta App 時，能搶走別的租戶的粉專訊息。（Webhook）
- 系統維護的 settings 鍵與憑證的 `connectMode` 不接受租戶輸入。改 settings 時沿用 `patchChannelSettings` 的原子合併，不要讀出整包再寫回。（渠道設定）
- 日誌與稽核紀錄不可放憑證。`GET /channels/:id` 只回遮罩值。（渠道設定）
- 驗簽：`FB`、`THREADS` 用 `appSecret`，其他用 `channelSecret`。（Webhook）
- 刪除是硬刪除（CHAN-01）。有對話的渠道只能停用；要下架用 `isActive: false`。（停用與刪除）
- `GET /channels/:id/status` 不可寫入。「最後驗證」只由測試連線更新（主規格 `channel-management`）。（Webhook）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。

## 回歸清單

改到本領域時，至少重走：

1. 新增 LINE、FB、IG、WebChat 各一個（表單與精靈各一次）：
   - 重新整理後渠道仍在，`webhookUrl` 正確。
   - 停用、再啟用。
   - 刪除沒有對話的渠道成功；刪除有對話的渠道回 409。
2. 用只綁一個渠道、沒有 `channel.view_all` 的自訂角色：
   - 列表只看到自己的渠道。
   - 對其他渠道的 `GET`、`PATCH`、`DELETE /channels/:id` 與 `/verify` 回 404。
   - 只有 `read_only` 的渠道，`PATCH`、`DELETE` 回 403。
   - `POST /channels/webhook-base-url` 回 403（需要 `channel.view_all`）。
3. FB webhook：
   - `GET /webhooks/fb/:id` 的訂閱驗證：正確的 `verifyToken` 回 200，錯的回 403。
   - 以 `appSecret` 簽章送 POST，分別驗證四種結果與卡片的警示：自己的粉專、改派給同 App 的渠道、不同 App 丟棄、沒人認領丟棄。
4. Bot 設定：
   - 存 `maxBotReplies` 10，重新整理後讀回 10。超出 1 到 50 回 400。
   - 把對話的 `botRepliesCount` 調到上限，再進一則訊息，對話變成 `AGENT_HANDLED`。
5. 用 supervisor（只有 `channel.view`）與 agent（沒有渠道權限）確認按鈕與 403。
6. 改到 `apps/api/src/services/channel-visibility.ts` 時，也走 `feature-inbox` 的回歸清單。

自動測試：

- `pnpm --filter @open333crm/api test -- tests/unit/modules/channel tests/unit/services/channel-visibility tests/unit/modules/webhook/threads-webhook`
- `pnpm --filter @open333crm/web test -- tests/unit/components/settings/channel tests/unit/components/settings/bot-config`
- `pnpm --filter @open333crm/workers test -- plugin-registry`
- `pnpm --filter @open333crm/channel-plugins test -- account-id-parsing threads-plugin`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/channel modules/meta-connect modules/webhook/webhook-account-routing migrations/backfill-unbound-channel-access`。
- E2E：`apps/web/tests/e2e-uat/tenant-settings-channels.spec.ts`。
  - UAT 是正式環境：**不改渠道設定、不按「測試連線」**。
  - 開渠道管理頁會對 FB 打 Meta API。唯讀檢查時要攔截 `/status`。

## 常見 bug 從哪裡查

- 「渠道收不到訊息」：
  - 先看卡片的分派警示與權杖紅框（`apps/web/src/components/settings/ChannelAccountRouting.tsx`）。
  - LINE：看 Channel Secret 是否正確。測試連線只驗 Access Token，Secret 錯也顯示成功（HC-CHANNELS-05）。
  - FB、IG：看 `externalAccountId` 是否已取得，Meta App 是否 Live。
- 「A 粉專的訊息跑到 B 租戶或 B 渠道」：看 `apps/api/src/modules/webhook/webhook-account-routing.ts` 的 `routeWebhookMessages`。`META_WEBHOOK_ROUTING=legacy` 會退回只看網址。
- 「自動化在某渠道送不出去」：看 `apps/workers/src/lib/plugin-registry.ts` 有沒有該外掛。收件匣會有一則「系統未載入 … 渠道外掛」的失敗訊息。
- 「分店看得到或改得到別店的渠道」：看 `apps/api/src/modules/channel/channel.routes.ts` 該路由有沒有掛 `requireVisibleChannel`（內部呼叫 `assertChannelVisible`）。
- 「權杖失效沒收到通知」：
  - 通知只寄給 `role` 為 `ADMIN` 的成員（HC-CHANNELS-04，RBAC-03）。
  - 只在「有效變成失效」或距上次通知 72 小時以上才寄（`apps/api/src/modules/channel/meta-token-health.ts`）。
- 「背景圖換不上去」：上傳 API 回 400，但畫面不顯示（HC-CHANNELS-03）。看瀏覽器 Network 的 `/chatbox-theme/background` 回應。
