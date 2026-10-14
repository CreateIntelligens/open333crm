## MODIFIED Requirements

### Requirement: 相同 email 自動合併
送出的 email 與同租戶另一位未封存聯絡人的 email 相同（不分大小寫）時，系統 SHALL 不經人工確認，把連結對應的聯絡人併入使用該 email、建立時間最早的聯絡人，合併紀錄的來源為 `EMAIL`。最早的一位就是登記方自己時，不合併。兩位聯絡人的手機號碼不一致時不自動合併（見「手機號碼不一致時不自動合併」）。合併後，渠道身分、對話、案件與其他關聯資料都屬於被併入的那位聯絡人。

#### Scenario: 不同渠道的同一個人
- **WHEN** FB 聯絡人 B 的 email 是 `amy@example.com`，LINE 聯絡人 A 透過登記連結送出 `AMY@example.com`
- **THEN** A 併入 B 並封存，A 的 LINE 身分與對話屬於 B，合併紀錄的來源為 `EMAIL`

#### Scenario: 多位聯絡人使用相同 email
- **WHEN** 聯絡人 B（較早建立）與 C 都使用 `amy@example.com`，A 送出這個 email
- **THEN** A 併入 B，C 不變

#### Scenario: 登記方本身就是最早使用該 email 的聯絡人
- **WHEN** 聯絡人 B（較早建立）與 C 都使用 `amy@example.com`，B 的渠道身分送出這個 email
- **THEN** 系統只寫入 email，B 與 C 都不合併

#### Scenario: 已封存的聯絡人不列入比對
- **WHEN** 唯一使用相同 email 的聯絡人已被封存
- **THEN** 系統只寫入 email，不合併

#### Scenario: 已經是同一位聯絡人
- **WHEN** A 已併入 B 之後，A 原本的 LINE 身分（現屬 B）再次送出 B 的 email
- **THEN** 系統不合併，回覆已登記

## ADDED Requirements

### Requirement: 手機號碼不一致時不自動合併
相同 email 的兩位聯絡人都有電話、且統一格式後不同時，系統 SHALL NOT 合併、SHALL NOT 寫入 email，登記結果為 `identity_conflict`，並在原對話回覆需要客服確認。其中一位沒有電話，或電話統一格式後相同時，照常合併。

#### Scenario: 兩邊的手機不同
- **WHEN** FB 聯絡人 B 的 email 是 `amy@example.com`、電話是 `0912-345-678`，電話為 `0988000111` 的 LINE 聯絡人 A 送出 `amy@example.com`
- **THEN** 不合併，A 的 email 不變，A 的對話收到需要客服確認的說明，登記結果為 `identity_conflict`

#### Scenario: 兩邊的手機寫法不同但是同一支
- **WHEN** B 的電話是 `0912-345-678`，電話為 `+886 912 345 678` 的 A 送出 B 的 email
- **THEN** A 併入 B
