import type { Field } from 'react-querybuilder';

export const automationFields: Field[] = [
  { name: 'contact.name', label: '聯絡人名稱', inputType: 'text' },
  {
    name: 'contact.channel',
    label: '聯絡人渠道',
    valueEditorType: 'select',
    values: [
      { name: 'LINE', label: 'LINE' },
      { name: 'FB', label: 'Facebook' },
      { name: 'WEBCHAT', label: 'WebChat' },
    ],
  },
  { name: 'contact.tags', label: '聯絡人標籤', inputType: 'text' },
  { name: 'contact.language', label: '聯絡人語言', inputType: 'text' },
  { name: 'case.open.count', label: '開啟案件數', inputType: 'number' },
  { name: 'message.text', label: '訊息內容', inputType: 'text' },
  {
    name: 'is_vip_customer',
    label: '是否 VIP 客戶',
    valueEditorType: 'select',
    values: [
      { name: 'true', label: '是' },
      { name: 'false', label: '否' },
    ],
  },
  {
    name: 'conversation.channelType',
    label: '對話渠道',
    valueEditorType: 'select',
    values: [
      { name: 'LINE', label: 'LINE' },
      { name: 'FB', label: 'Facebook' },
      { name: 'WEBCHAT', label: 'WebChat' },
    ],
  },
  {
    name: 'conversation.status',
    label: '對話狀態',
    valueEditorType: 'select',
    values: [
      { name: 'ACTIVE', label: '進行中' },
      { name: 'PENDING', label: '等待中' },
      { name: 'CLOSED', label: '已關閉' },
    ],
  },
];
