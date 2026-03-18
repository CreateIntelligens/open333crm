import type { Field } from 'react-querybuilder';

export const automationFields: Field[] = [
  { name: 'contact.name', label: 'Contact Name', inputType: 'text' },
  {
    name: 'contact.channel',
    label: 'Contact Channel',
    valueEditorType: 'select',
    values: [
      { name: 'LINE', label: 'LINE' },
      { name: 'FB', label: 'Facebook' },
      { name: 'WEBCHAT', label: 'WebChat' },
    ],
  },
  { name: 'contact.tags', label: 'Contact Tags', inputType: 'text' },
  { name: 'contact.language', label: 'Contact Language', inputType: 'text' },
  { name: 'case.open.count', label: 'Open Case Count', inputType: 'number' },
  { name: 'message.text', label: 'Message Text', inputType: 'text' },
  {
    name: 'is_vip_customer',
    label: 'Is VIP Customer',
    valueEditorType: 'select',
    values: [
      { name: 'true', label: 'Yes' },
      { name: 'false', label: 'No' },
    ],
  },
  {
    name: 'conversation.channelType',
    label: 'Conversation Channel',
    valueEditorType: 'select',
    values: [
      { name: 'LINE', label: 'LINE' },
      { name: 'FB', label: 'Facebook' },
      { name: 'WEBCHAT', label: 'WebChat' },
    ],
  },
  {
    name: 'conversation.status',
    label: 'Conversation Status',
    valueEditorType: 'select',
    values: [
      { name: 'ACTIVE', label: 'Active' },
      { name: 'PENDING', label: 'Pending' },
      { name: 'CLOSED', label: 'Closed' },
    ],
  },
];
