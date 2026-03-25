# 23 - Short URL Tracking / LIFF + Multi-Channel
# 短連結追蹤系統

## Position / 定位

> Marketing core tool: all outbound links go through short URLs.
> Each click auto-identifies the user + records behavior + auto-tags.
>
> 行銷核心工具：所有對外連結都走短連結，
> 每次點擊自動識別身份 + 記錄行為 + 自動貼標。

---

## Click Handler Logic & Automation / 點擊處理邏輯與自動化

```typescript
async function handleClick(slug: string, liffData?: LiffClickData, refToken?: string) {
  // ... (find link & create log)

  let contact: Contact | null = null;
  // ... (identify contact)

  if (contact) {
    click.contactId = contact.id;
    // ... (add tags & attributes)
    
    // --- 觸發自動化 ---
    await eventBus.publish('link.clicked', {
      contactId: contact.id, linkId: link.id, linkName: link.name, tags: link.tags,
    });
  }

  // ... (increment clicks & redirect)
}
```

**自動化範例**:
- **觸發**: `link.clicked` (linkName: "春季空調優惠")
- **條件**: Contact 標籤包含 `VIP`
- **動作**: 立即發送「小鈴鐺」通知給該客戶的專屬業務。

---
(其餘內容保持不變)
