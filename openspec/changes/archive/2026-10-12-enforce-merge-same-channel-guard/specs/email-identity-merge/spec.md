## MODIFIED Requirements

### Requirement: 同一渠道雙方都有身分時拒絕合併
相同 email 的兩位聯絡人在同一個渠道都有身分時，系統 SHALL NOT 合併、SHALL NOT 寫入 email，並在原對話回覆無法自動整合、請聯繫客服。合併前檢查時通過、合併時才被合併引擎以 `SAME_CHANNEL_CONFLICT` 拒絕時（另一個合併同時進行），系統 SHALL 以相同方式處理。

#### Scenario: 同一個 LINE OA 的兩個帳號
- **WHEN** 聯絡人 A 與 B 在同一個 LINE 渠道都有身分，A 送出 B 的 email
- **THEN** 不合併，A 的 email 不變，A 的對話收到無法自動整合的說明

#### Scenario: 合併時才發現同一渠道
- **WHEN** A 送出 B 的 email，合併前檢查通過，但合併時合併引擎以 `SAME_CHANNEL_CONFLICT` 拒絕
- **THEN** 不合併，A 的 email 不變，A 的對話收到無法自動整合的說明，登記結果為 `channel_conflict`

## ADDED Requirements

### Requirement: 同一個 email 的登記依序處理
同一個租戶內，系統 SHALL 依序處理送出相同 email（不分大小寫）的登記：後送出的登記在前一個完成之後才查詢使用這個 email 的聯絡人。

#### Scenario: 兩位聯絡人同時登記同一個新的 email
- **WHEN** 沒有任何聯絡人使用 `amy@example.com`，LINE 聯絡人 A（較早建立）與 FB 聯絡人 B 同時送出 `amy@example.com`
- **THEN** 兩個登記都完成後，A 與 B SHALL 是同一位未封存的聯絡人，使用 `amy@example.com`

#### Scenario: 不同 email 不互相等待
- **WHEN** A 送出 `amy@example.com` 的同時，B 送出 `bob@example.com`
- **THEN** 兩個登記 SHALL 各自完成，不合併
