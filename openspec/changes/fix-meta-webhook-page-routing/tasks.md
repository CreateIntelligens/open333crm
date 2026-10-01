## 0. 查證（已完成）

- [x] 0.1 UAT 實測確認錯置：Open333test（1132326913296788）與創造智能（126104163728610）共用 Meta App 671495162407854，回呼指向創造智能渠道，Open333test 訊息落進創造智能租戶、回覆被 Meta 拒（2026-09-30）
- [x] 0.2 確認 webhook 本身正常：App subscription active、粉專已訂閱且含 `messaging_referrals`
- [x] 0.3 Meta 文件確認 IG Login `/me` 的 `user_id` 才是 webhook `entry.id`，`id` 為 App 範圍 ID

## 1. 第 2 階段先行：資料庫欄位（第 1 階段分派依賴此欄位）

- [x] 1.1 schema：`Channel.externalAccountId String?`、`@@unique([channelType, externalAccountId])`
- [x] 1.2 產生正式 migration SQL（加欄位＋唯一索引；中文註解說明與回滾），確認 `channels` 既有 RLS policy 不需改
- [x] 1.3 `channel.service`：`listChannels`／`getChannel` 回傳 `externalAccountId`

## 2. 第 1 階段：插件帶出 accountId

- [x] 2.1 `ParsedWebhookMessage` 加 `accountId?: string`
- [x] 2.2 FB `parseWebhook`：每則帶 `accountId = entry.id`；非 `object: 'page'` 的 payload 不解析
- [x] 2.3 IG `parseWebhook`：每則帶 `accountId = entry.id`；非 `object: 'instagram'` 的 payload 不解析
- [x] 2.4 插件測試：accountId、多 entry、object 不符

## 3. 第 1 階段：依 accountId 分派

- [x] 3.1 `processWebhookEvent`：驗簽後依 accountId 分組，以 `findUnique(channelType_externalAccountId)` 找目標渠道（prismaAdmin）
- [x] 3.2 目標渠道檢查：isActive、tenant.isActive、appSecret 與驗簽 secret 相同
- [x] 3.3 找不到目標：網址渠道無帳號 ID → 相容模式交網址渠道；有且不同 → 丟棄
- [x] 3.4 每組以目標渠道的 credentials／tenantId 呼叫 `processInboundMessage`
- [x] 3.5 分派警示：`settings.webhookRouting`（原子更新、加入 `SYSTEM_MANAGED_SETTING_KEYS`）＋ `logger.warn`
- [x] 3.6 下游轉發：只有整包都屬網址渠道才轉發（immediate 短路同條件）
- [x] 3.7 測試：跨租戶分派、多 entry、未連結帳號丟棄、相容模式、appSecret 不符丟棄、下游轉發略過、租戶停用的目標渠道；突變驗證
- [x] 3.8 `check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`（區分 main 既有失敗）

## 4. 第 2 階段：寫入與唯一限制

- [x] 4.1 `verifyChannel`：FB 寫入 `/me` 的 `id`；IG 改打 `fields=user_id,username`，寫入 `user_id`
- [x] 4.2 ~~`createChannel`／`updateChannel`：FB 有 `pageId` 時寫入~~ 改為**只由驗證寫入**（design D4b，手填 ID 可被用來搶別人的粉專）；更新 token／App Secret 時清空帳號 ID；P2002 → 409 `CHANNEL_ACCOUNT_ALREADY_LINKED`（中文訊息）
- [x] 4.3 verify 撞重複時回報失敗原因（不靜默、不寫入）
- [x] 4.4 回填腳本 `backfill-channel-external-account-id.ts`（dry-run 預設、`--apply` 才寫、先比對重複，衝突全部不寫並列出）
- [x] 4.5 `fb-token-monitor` 寫回 settings 改用 `patchChannelSettings`
- [x] 4.6 測試：唯一限制（跨租戶、同租戶）、IG user_id、換 token 清空（回填衝突偵測未寫自動測試，UAT 回填 dry-run 時人工確認）

## 5. 第 2 階段：前端

- [x] 5.1 渠道卡片顯示已連結帳號 ID；未取得時提示「請按驗證」
- [x] 5.2 渠道卡片顯示分派警示（收到不屬於本渠道的帳號事件、尚未取得帳號 ID）與處理建議
- [x] 5.3 FB 表單／精靈：粉專 ID 改為驗證後自動帶入、唯讀顯示；`ChannelFieldGuide` 文案更新
- [x] 5.4 409 `CHANNEL_ACCOUNT_ALREADY_LINKED` 的錯誤呈現

## 6. 第 1、2 階段收尾

- [x] 6.1 CHANGELOG（`## [YYYY-MM-DD]`）
- [x] 6.2a code review（第 1、2 階段）：1 高 3 中已修（design D9），突變驗證
- [x] 6.2b 第 3 階段 code review：2 中 7 低已修（design D10），突變驗證
- [ ] 6.2 push、開 PR（須使用者同意）
- [ ] 6.3 UAT 部署清單：2 支 migration（`20260930100000_add_channel_external_account_id`、`20260930110000_release_inactive_channel_account`，須 owner 連線）→ 停用 Demo Facebook（與 test333 同一粉專）→ 回填 dry-run → `--apply` → 確認渠道卡片警示
- [ ] 6.4 UAT 驗證：Open333test 訊息落在預設租戶、創造智能訊息仍落在創造智能租戶、兩邊都收得到回覆

## 7. 第 3 階段：平台 Meta App（程式）

- [x] 7.1 env：`META_APP_ID`、`META_APP_SECRET`、`META_WEBHOOK_VERIFY_TOKEN`、`META_LOGIN_CONFIG_ID`；未設定時相關端點回 503
- [x] 7.2 credentials 加 `connectMode: 'platform' | 'own_app'`；分派的 secret 比對支援 platform 模式
- [x] 7.3 `GET/POST /api/v1/webhooks/meta`（平台驗證權杖、平台 secret 驗簽、依 object 與 entry.id 分派）
- [x] 7.4 `modules/meta-connect/`：start（Redis state）、callback（換長效 token、`/me/accounts`、加密暫存）、pages 列表、選定建立渠道＋`subscribed_apps` 訂閱（失敗不留半套）
- [x] 7.5 ~~`check-prisma-admin-usage.mjs` 白名單加入 `modules/meta-connect/`~~ 不需要：callback 只碰 Redis 與 Graph API，不查資料庫；平台 webhook 在既有白名單的 `modules/webhook/`
- [x] 7.6 前端：「用 Facebook 連結粉專」按鈕、粉專選擇頁（已連結的標示不可選）
- [x] 7.7 測試：state 竄改／過期／重用、token 不回傳前端、訂閱失敗回滾、已連結粉專
- [x] 7.8 重新連結：本租戶已連結的粉專可在選擇頁勾選，更新原渠道權杖（保留渠道 id、對話、設定），先用新權杖訂閱成功才寫入；稽核紀錄 `channel.update`；只限平台模式渠道，自備應用程式渠道回 `OWN_APP_CHANNEL`（避免下游轉發靜默停止）
- [x] 7.9 權杖失效通知：每 6 小時（leader lock）檢查啟用中的 FB／IG 渠道權杖，失效寫入 `settings.tokenHealth`（系統維護欄位）、渠道卡片紅色警示、站內通知＋email 給租戶管理員，持續失效每 3 天再提醒；網路錯誤、Meta 5xx、限流不改狀態；測試連線成功清除警示；檢查途中權杖被換掉則不寫入
- [x] 7.10 API log 遮蔽網址上的 `code`、`state`、`access_token`、`token`、`hub.verify_token`（OAuth callback 的授權碼與 webhook 驗證權杖不進 log）

## 8. 第 3 階段：Meta 端前置（平台方在 Meta 後台操作，非程式）

- [ ] 8.1 決定平台 App（沿用 671495162407854 或另建）；建立 Facebook Login for Business 設定取得 config ID
- [ ] 8.2 `pages_show_list`、`pages_manage_metadata`、`pages_messaging` 進階存取送審（含操作錄影）
- [ ] 8.3 商業驗證；App 切換 Live
- [ ] 8.4 Page 回呼網址改為 `/api/v1/webhooks/meta`，設定平台驗證權杖

## 9. 後續評估（不在本 change）

- [ ] 9.0 平台連結模式渠道的下游轉發（目前平台層事件不轉發）
- [ ] 9.0c 平台 App 開啟 Require App Secret 時，收發訊息（插件 sendMessage／getProfile、verify）也要帶 appsecret_proof
- [ ] 9.0d 支援系統使用者權杖（SUAT）類型的 Facebook Login for Business 設定
- [ ] 9.0b 精靈建立渠道後驗證 409 時，重複的渠道仍留著（ID 為 NULL、佔用渠道數名額；不會外洩），可考慮提示刪除

- [ ] 9.1 IG 走 Facebook Login（`instagram_manage_messages`、`graph.facebook.com/{PAGE_ID}/messages`）與現行 IG Login 路線的整合方式
- [ ] 9.2 既有自備 App 渠道遷移到平台模式的引導流程（需先支援平台模式的下游轉發 9.0，否則遷移會讓下游轉發停止）
- [ ] 9.3 worker `credentials.ts` 的 `'fallback-open333crm-key'` 預設金鑰與 API 行為不一致（盤點時發現，另案處理）
