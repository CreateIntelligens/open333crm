# aitago ↔ open333 整合對齊清單

> **對象**：aitago 工程團隊
> **發件**：open333 整合負責人
> **日期**：2026-04-20
> **對應規格**：`.claude/docs/24_AITAGO_INTEGRATION.md`

---

## 背景

open333（我們的跨渠道客服中心）要與 aitago 做**淺整合**：
- aitago 繼續負責 LINE OA 所有功能（Webhook 接收、Rich Menu、優惠券、觸發腳本等）
- open333 透過 API 拉取 **會員（line_users）** 與 **Tag**，必要時取用對話記錄
- 兩邊不合併功能，只共享資料

我們讀了 aitago 的 OpenAPI spec（`aitago-api-251106.json`，104 個端點）寫完整合規格。
以下 15 題需要你們的團隊確認，否則我們先用我們的推測實作，之後再調整。

---

## 一、環境與認證

### Q1. 正式環境 API URL
規格看到的是 `https://feature-line-crm.aitago.tw/api`（Feature 環境）。

- 正式環境 Base URL 是？
- UAT / Staging 各自的 URL 是？
- 是否每個租戶（商家）有獨立 subdomain，還是共用一個 base URL？

**🔴 影響單**：CM-67（直接阻塞，無 URL 無法做真實連線）

### Q2. Token 生命週期
看到 `POST /token`、`POST /token/refresh`、`POST /token/revoke`。

- Access Token 有效期多久？
- Refresh Token 有效期多久？
- 我們計畫在過期前 5 分鐘自動 refresh，可行？
- 如果 refresh 也過期了，正確流程是？

**🟡 影響單**：CM-68（可先用假設值 1hr 做，之後調整）

### Q3. Client 憑證申請
- open333 要接 aitago，該怎麼申請 Client ID / Client Secret？
- 是每個 aitago 租戶發一組，還是 open333 整個平台一組？
- 有沒有 scope / permission 機制（例如：只能讀、不能刪）？

**🔴 影響單**：CM-67（直接阻塞，無憑證無法驗證）

### Q4. Rate Limit
- 每分鐘 / 每小時上限？
- Rate Limit 超過時回什麼 status code 與 header？
- 建議的 token bucket 容量？

**🟡 影響單**：CM-69（同步 worker 需依此設計）、CM-74（Tag 推回）、CM-77（代發訊息）

---

## 二、資料同步

### Q5. 增量查詢支援
全量拉會員對大量級客戶太慢。

- `GET /line_users` 是否支援 `updated_at > X` filter？
- 或有沒有 `since` / `cursor` 參數？
- 排序是否固定（建議：`updated_at ASC`）？

**🟡 影響單**：CM-69（無增量查詢，10,000+ 會員效能可能不足）

### Q6. 分頁一致性
我們用 `page + per_page` 分頁，如果中途有新增刪除會不會錯過資料？

- 是 cursor pagination 還是 offset pagination？
- 建議的 per_page 上限？
- 多頁查詢時有資料變動怎麼處理？

**🟡 影響單**：CM-69（大量資料可能在分頁間變動導致遺漏）

### Q7. Unfollow / Block 事件
會員取消追蹤（unfollow_at 有值）後：

- 還能繼續呼叫 `GET /line_users/{id}` 嗎？
- 該會員的 tags 還會更新嗎？
- 我們在 open333 應該把 Contact archive 還是保留？建議行為？

**🟢 影響單**：CM-69、CM-70（Contact 狀態處理邏輯，不阻塞開工）

### Q8. Webhook 事件推送
OpenAPI 只看到 aitago 自己接 LINE 的 webhook `POST /line/webhook`。

- aitago 對**外部系統**（例如 open333）有主動推送 webhook 的機制嗎？
- 若有：設定頁在哪？事件類型有哪些？payload 格式？
- 若沒有：我們改用 **每 10 分鐘輪詢** 是最佳實作？

**我們希望的 5 種事件**：
- `member.updated` — 會員資料變更
- `member.tagged` / `member.untagged` — 標籤變更
- `member.unfollowed` — 取消追蹤
- `conversation.escalated` — 客服升級請求（最重要，即時性高）

**🔴 影響單**：CM-75（若無 outbound webhook，需重新設計為純輪詢觸發模式）

---

## 三、標籤

### Q9. Tag 同步衝突
- 兩邊都允許建 Tag，如果都叫「VIP」，aitago 那邊有一個 tag_id=5，open333 那邊有 open333 自己的 tag_id。該視為同一筆還是不同筆？
- 我們建議：**同 tenantId + 同 name 視為同一筆**。同意嗎？

**🟡 影響單**：CM-72（採預設規則先做，若 aitago 不同意需調整）

### Q10. 推 Tag 的權限
我們計畫 open333 客服打 Tag 時，呼叫 `PUT /line_users/tagging_tag` 推回 aitago。

- 需要特殊權限嗎？
- 速率限制跟一般 API 一樣還是更嚴？
- 新建 Tag 要先 `POST /tags` 才能打，是這樣嗎？

**🟡 影響單**：CM-74（可能需調整推送策略）

---

## 四、對話與訊息

### Q11. 代發訊息能力
Case 處理時希望 open333 能透過 aitago 發 LINE 訊息。

- `POST /conversations/:id/messages` 支援哪些訊息類型？（text / image / flex / sticker？）
- 發送後會**扣 aitago 商家的 LINE 推播額度**嗎？
- 有沒有限制哪些 Sender 能發？
- 我們 P2 階段只打算支援純文字，這樣會遇到問題嗎？

**🟡 影響單**：CM-77（計費未明，可能需商業模式討論）

### Q12. 對話狀態同步
- `PATCH /conversations/:id` 支援哪些 status 值？
- open333 幫客戶 resolve 了 Case，需要同步更新 aitago 這邊的 conversation status 嗎？
- 同一個 LINE user 若同時在 aitago 端被標「處理中」又在 open333 有 Case，誰為準？

**🟢 影響單**：CM-75、CM-77（不阻塞，可後續迭代）

### Q13. 訊息歷史讀取
- `GET /conversations/:id/messages` 能查多久以前的訊息？
- 每次能拉幾筆（per_page 上限）？
- 有沒有 full-text search？

**🟢 影響單**：CM-76（UI 可動態調整，不阻塞）

---

## 五、UI 與呈現

### Q14. iframe 嵌入政策
我們想在 open333 後台以 iframe 嵌入 aitago 的 Rich Menu / 優惠券 / 觸發腳本頁。

- aitago 的 `X-Frame-Options` 或 `CSP frame-ancestors` 目前設什麼？
- 可否對特定 origin（例如 `https://*.open333.com`）放行？
- 有沒有支援 SSO（讓使用者不用再登一次）？若有，協定是 OAuth / SAML / 自訂？

**🟡 影響單**：CM-78（若不允許 iframe，降級為「連結預覽 + 跳轉」模式）

### Q15. 深連結
- 給 line_user_id 能直接連到 aitago 會員詳情頁嗎？URL 格式？
- 給 conversation_id 能連到對話頁？

**🟢 影響單**：CM-70、CM-76、CM-78（體驗增強項，不阻塞）

---

## 六、其他（非必答）

- 雙邊資料有衝突時的**權威方**政策？例如會員 email 兩邊不同時以誰為準？（我們建議 aitago 為準，因為是行銷主系統）
- 租戶（商家）級別的限流或配額有不同嗎？
- aitago 是否規劃 outbound webhook 機制？若有，預計何時上線？

---

## 我們的初步實作計畫

基於以下**假設**先開工，若 Q1–Q15 答案有落差再調整：

1. 用 `feature-line-crm.aitago.tw/api`（Feature 環境）開發，正式環境 Q1 回後切換
2. Access Token 1 小時有效、提前 5 分鐘刷新
3. 無增量查詢 → 每 10 分鐘全量拉 `page=1..N` 直到拿完
4. 無 outbound webhook → 純輪詢 + 需要即時性的「客服升級」請 aitago 做一個單點 push（Q8）
5. Tag 合併原則 = 同 tenant + 同 name
6. 代發訊息 P2 階段只做純文字
7. iframe 若被擋 → 降級為「列表縮圖 + 跳轉 aitago」

---

## 期望回覆時程

- 我們計畫 2026-04-28 開始 Sprint 1（US-A1/A2 連線設定）
- 希望 Q1–Q4 在 **04-24** 前有答，否則排程會延後
- Q5–Q15 可以分批回，越早給我們越能把實作做對

**聯絡窗口**：Daniel（open333 整合負責人）dy052340@gmail.com

---

## 附件

- open333 整合規格全文：`.claude/docs/24_AITAGO_INTEGRATION.md`
- Jira Epic：CM-66，子單 CM-67 ~ CM-77
