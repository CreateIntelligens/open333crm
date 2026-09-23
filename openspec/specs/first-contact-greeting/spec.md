# first-contact-greeting Specification

## Purpose

渠道層級的首次進站招呼語：粉絲在某渠道首次被建立為聯絡人時，系統自動送出一則親切的招呼訊息，並保證多實例與併發環境下每位聯絡人於每個渠道僅發送一次。

## Requirements

### Requirement: 首次進站時送出招呼語

當某渠道的聯絡人身分（channel + uid）為首次建立，且該渠道已設定招呼語時，系統 SHALL 送出一則招呼訊息，並使其寫入對話紀錄、推送至該渠道。

#### Scenario: 全新粉絲第一次傳訊息

- **GIVEN** 渠道已設定招呼語
- **AND** 該粉絲的渠道身分在系統中尚不存在
- **WHEN** 該粉絲傳送第一則訊息
- **THEN** 系統建立聯絡人與渠道身分
- **AND** 送出一則招呼訊息（`direction: OUTBOUND`）
- **AND** 該訊息寫入對話紀錄並推送至該渠道

#### Scenario: LINE 加好友當下即招呼

- **GIVEN** LINE 渠道已設定招呼語
- **WHEN** 粉絲加入該官方帳號為好友（`follow` 事件）
- **THEN** 系統送出招呼訊息，不需等待粉絲先發話

#### Scenario: 未設定招呼語的渠道維持現狀

- **GIVEN** 渠道未設定招呼語（未設定或為空字串）
- **WHEN** 全新粉絲首次來訊
- **THEN** 不送出任何招呼訊息
- **AND** inbound 訊息本身照常落地

### Requirement: 招呼語每位聯絡人於每渠道只送一次

系統 SHALL 確保同一渠道身分只收到一次招呼語，於多實例部署、併發請求與平台重複投遞下皆成立。

#### Scenario: 同一粉絲連續傳多則訊息

- **GIVEN** 粉絲首次來訊並已收到招呼語
- **WHEN** 該粉絲繼續傳送後續訊息
- **THEN** 不再送出招呼語

#### Scenario: 加好友後緊接著傳訊息

- **GIVEN** 粉絲加好友觸發招呼語
- **WHEN** 該粉絲隨即傳送第一則訊息
- **THEN** 不再送出第二次招呼語

#### Scenario: 併發或重複投遞

- **GIVEN** 同一粉絲的兩筆 inbound 幾乎同時抵達（平台重複投遞或多實例併發）
- **WHEN** 兩者都嘗試建立渠道身分
- **THEN** 僅其中一筆被判定為首次
- **AND** 招呼語只送出一次

#### Scenario: 既有聯絡人不會被誤判

- **GIVEN** 該渠道身分早已存在於系統
- **WHEN** 該粉絲來訊
- **THEN** 不送出招呼語

### Requirement: 招呼語支援聯絡人變數

招呼語 SHALL 支援以變數帶入聯絡人資訊，於送出前完成替換。

#### Scenario: 招呼語帶入顯示名稱

- **GIVEN** 招呼語內容包含聯絡人顯示名稱的變數
- **WHEN** 招呼語送出
- **THEN** 訊息內容中的變數已替換為該聯絡人的顯示名稱

#### Scenario: 變數無法解析時不擋發送

- **GIVEN** 招呼語含有無法解析的變數
- **WHEN** 招呼語送出
- **THEN** 仍送出訊息（未解析部分維持原樣）
- **AND** inbound 訊息本身不受影響

### Requirement: 招呼語失敗不得影響 inbound 訊息

招呼語的產生或發送若失敗，系統 SHALL 記錄錯誤並繼續，不得使 inbound 訊息的落地失敗。

#### Scenario: 發送至渠道時失敗

- **GIVEN** 招呼語已設定
- **AND** 推送至渠道的過程發生錯誤
- **WHEN** 系統處理該筆 inbound 訊息
- **THEN** inbound 訊息仍正常寫入並出現在收件匣
- **AND** 錯誤被記錄

### Requirement: 聯絡人建立時發布 contact.created 事件

當系統建立新聯絡人時，SHALL 發布 `contact.created` 事件，使既有自動化引擎可以此為觸發條件。

#### Scenario: 新聯絡人建立

- **GIVEN** 全新粉絲首次來訊
- **WHEN** 系統建立該聯絡人
- **THEN** 發布 `contact.created` 事件，並帶有該聯絡人與租戶資訊

#### Scenario: 事件發布失敗不影響主流程

- **GIVEN** 事件發布過程發生錯誤
- **WHEN** 系統處理該筆 inbound 訊息
- **THEN** 聯絡人、對話與訊息仍正常建立
