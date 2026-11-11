## Why

Issue #420（AUDIT KB-02、健檢 HC-KNOWLEDGE-02）：知識庫自動回覆的型號守門用不分大小寫的正規式抓型號，`Wi-Fi`、`e-mail`、
`T-shirt`、訂單編號 `AB-12345` 都被當成型號。知識庫相似度低於 0.85 時，機器人回「這個型號我這邊查不到資料」，請客人確認型號。
守門對所有租戶生效：沒有型號文章的租戶白名單是空的，只要訊息有這類詞就一定走守門。守門路徑也不累加追問次數，
客人一直提到這類詞就一直不會轉真人。

## What Changes

- `detectModels()` 維持不分大小寫、結果轉成大寫（`tac-11p` 與 `TAC-11P` 視為同一個），排除轉大寫後是常見英文詞的
  （`WI-FI`、`E-MAIL`、`T-SHIRT`、`USB-C`、`TYPE-C`、`HDMI-2`、`CD-R`、`DVD-R`；清單沿用 `packages/kb-ingest` 的停用詞）。
  型號白名單也用同一個函式從文章標題抽出，標題裡的這些英文詞不再進白名單。
- 型號守門只攔截前綴（品類碼）出現在白名單的型號。前綴不在白名單的編號（訂單編號）不攔截；知識庫沒有型號文章
  （白名單空）時，等於不啟用守門。
- 守門回覆計入追問次數（`clarifyAttempts`）。追問次數已達 `clarifyMaxAttempts` 時，命中守門的訊息改走追問用完的路徑：
  回「已為您轉接客服人員」並以 `handOffConversation()` 轉接真人（與 #419 同一條路徑）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `bot-handoff-config`：修改「知識庫追問用完或 AI 失敗時轉接真人」，型號守門回覆計入追問次數、用完時轉接；
  新增「型號守門只攔截知識庫型號格式的型號」（型號守門原本沒有主規格）。未歸檔的 `integrate-clef-decision-model`
  在同一個 capability 修改的是其他需求，沒有衝突。

審查後調整（協調者決定）：初版把偵測改成大小寫敏感，但已有前綴白名單擋住非型號的編號，大小寫敏感只會讓客人打小寫型號時
失去「請確認型號」的引導，因此恢復不分大小寫。

## Impact

- `apps/api/src/modules/ai/model-matcher.ts`、`apps/api/src/modules/ai/kb-autoreply.service.ts`。
- `model-registry.service.ts` 沿用 `detectModels()`：重建白名單後，標題裡的 `Wi-Fi` 等英文詞不再產生型號。
- 前綴打錯的型號（白名單沒有這個前綴）不再觸發守門，改走一般知識庫回答或追問。
- 文件：`docs/ref/system/AUDIT.md` KB-02、`AUDIT-REVIEWS.md`、`docs/ref/features/health/KNOWLEDGE.md`、
  `docs/ref/features/tenant/KNOWLEDGE.md`、`.claude/skills/feature-knowledge/SKILL.md`、`CHANGELOG.md`。
