# 07 — LLM 輔助回覆 + 知識庫 KM 設計

## 設計理念：輔助，不替代

open333CRM 的 LLM 功能**不是全自動 chatbot**，而是「客服助理」：
- LLM 看到對話 → 搜尋知識庫 → 提供建議回覆草稿
- 客服人員**確認後**才發送，或直接修改
- 透明、可控、可稽核

---

## 知識庫（KM）架構

### 知識文章（KnowledgeArticle）

```typescript
interface KnowledgeArticle {
  id: string;
  tenantId: string;
  title: string;
  content: string;         // Markdown 格式
  summary: string;         // 短摘要，供 LLM prompt 使用
  category: string;        // 分類：產品FAQ / 維修流程 / 退換貨政策
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  embedding?: number[];    // 向量化後的 embedding
  embeddingModel: string;  // 記錄用什麼模型向量化
  viewCount: number;
  helpfulCount: number;
  createdBy: string;
  updatedAt: Date;
}
```

### 知識庫分類（家電業者範例）

```
知識庫
├── 產品資訊
│   ├── 冰箱系列問題
│   ├── 洗衣機系列問題
│   └── 空調系列問題
├── 服務流程
│   ├── 維修申請流程
│   ├── 到府維修說明
│   └── 零件更換政策
├── 保固政策
│   ├── 標準保固條款
│   └── 延伸保固方案
└── 常見問題 FAQ
    ├── 產品操作問題
    └── 帳號與訂單問題
```

---

## RAG 流程（Retrieval Augmented Generation）

```
客戶發送訊息
      │
      ▼
1. 向量搜尋（Semantic Search）
   用戶訊息 → Embedding → 搜尋向量資料庫（pgvector）
   找出最相關的 Top-K 知識文章
      │
      ▼
2. 上下文組裝
   - 最近 N 輪對話歷程
   - Top-K 相關知識摘要
   - 聯繫人基本資訊（姓名、標籤、歷史案件）
      │
      ▼
3. LLM 生成建議回覆
   Model: OpenAI GPT-4o / 本地 Ollama（可設定）
   溫度：0.3（保守、準確）
      │
      ▼
4. 建議回覆顯示在客服介面
   客服看到 [建議回覆] 區塊，可：
   ✅ 直接採用
   ✏️ 修改後發送
   ❌ 忽略，自行輸入
      │
      ▼
5. 反饋記錄
   客服的選擇（採用/修改/忽略）回饋給系統，供未來優化
```

---

## 自動化中樞整合 (Automation Integration)

KM 模組除了給客服建議外，也會將檢索結果發送至 **Automation Engine** 以觸發自動化流程。

### 事件觸發 (Triggers)
| 事件名稱 | 觸發條件 | Payload 範例 |
|----------|----------|--------------|
| `km.search.hit` | 信心度 > 0.85 | `{ articleId: "...", confidence: 0.92, content: "..." }` |
| `km.search.partial` | 信心度 0.5 ~ 0.85 | `{ suggestions: [...], topConfidence: 0.72 }` |
| `km.search.miss` | 信心度 < 0.5 | `{ query: "..." }` |

### 執行動作 (Actions)
| 動作名稱 | 說明 | 參數 |
|----------|----------|------|
| `ai.generate_reply` | 根據文章生成回覆草稿供客服採用 | `{ articleId: "...", tone: "professional" }` |
| `ai.classify_intent` | 自動為聯繫人貼上意圖標籤 | `{ model: "gpt-4o-mini" }` |

---

## Prompt 設計

### System Prompt 模板

```
你是 {公司名} 的客服助理 AI。
你的任務是根據對話歷程和知識庫，提供準確、友善的建議回覆。

重要規則：
- 只回答知識庫中有依據的問題
- 若不確定，請說「需要確認後回答」，不要猜測
- 回覆語氣：親切、專業、簡潔
- 語言：{language}（繁體中文）

知識庫相關資訊：
{retrieved_knowledge_chunks}

聯繫人資訊：
姓名：{contact_name}
標籤：{contact_tags}
歷史案件：{case_summary}
```

---

## LLM 服務架構

```typescript
interface LLMService {
  // 生成建議回覆
  suggestReply(context: LLMContext): Promise<SuggestedReply>;

  // 分析對話情緒（正面/中性/負面）
  analyzeSentiment(messages: Message[]): Promise<SentimentResult>;

  // 摘要長對話（給客服快速了解背景）
  summarizeConversation(messages: Message[]): Promise<string>;

  // 分類問題（自動判斷 Case 分類）
  classifyIssue(messages: Message[]): Promise<IssueCategory>;
}

interface LLMContext {
  conversationHistory: Message[];
  latestMessage: Message;
  contactInfo: ContactSummary;
  retrievedKnowledge: KnowledgeChunk[];
  tenantConfig: LLMConfig;
}
```

---

## LLM 設定（可切換模型）

```typescript
interface LLMConfig {
  provider: 'openai' | 'azure_openai' | 'ollama' | 'anthropic';
  model: string;            // 'gpt-4o' / 'llama3' / 'claude-3-5-sonnet'
  apiKey?: string;
  endpoint?: string;        // 本地 Ollama endpoint 或 Azure endpoint
  temperature: number;      // 建議 0.2~0.5
  maxTokens: number;
  systemPromptTemplate: string;
  language: string;         // zh-TW
}
```

---

## 向量搜尋設定

- **向量維度**：`text-embedding-3-small` = 1536 維；`bge-m3`（本地）= 1024 維
- **向量資料庫**：`pgvector`（PostgreSQL Extension，Lite 版無需額外服務）
- **Top-K**：預設撈 5 篇最相關文章，可調整
- **相似度門檻**：cosine similarity > 0.72 才採用

---

## KM 管理介面功能

| 功能 | 說明 |
|------|------|
| 文章新增/編輯 | Markdown 編輯器，支援圖片 |
| 批量匯入 | CSV / JSON 批量新增 |
| 向量重建 | 更新文章後自動重新 Embedding |
| 文章效果追蹤 | 被採用次數、被忽略次數 |
| 搜尋測試 | 輸入問題，即時看到搜尋結果 |
| 版本歷程 | 文章修改歷程 |

---

## 成本控制策略

1. **快取機制**：相同問題的 LLM 結果快取 24 小時（Redis）
2. **Token Budget**：設定每月最大 Token 用量，超過後降級到本地模型
3. **選擇性啟動**：每個對話可手動開啟/關閉 AI 建議
4. **本地模型支援**：完整支援 Ollama，讓客戶可以完全本地化
