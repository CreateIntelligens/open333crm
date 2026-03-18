import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Deterministic UUIDs ─────────────────────────────────────────────────────

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

const ADMIN_ID = 'b0000000-0000-0000-0000-000000000001';
const SUPERVISOR_ID = 'b0000000-0000-0000-0000-000000000002';
const AGENT_ID = 'b0000000-0000-0000-0000-000000000003';

const TEAM_ID = 'c0000000-0000-0000-0000-000000000001';

const LINE_CHANNEL_ID = 'd0000000-0000-0000-0000-000000000001';
const FB_CHANNEL_ID = 'd0000000-0000-0000-0000-000000000002';
const WEBCHAT_CHANNEL_ID = 'd0000000-0000-0000-0000-000000000003';

const CONTACT1_ID = 'e0000000-0000-0000-0000-000000000001';
const CONTACT2_ID = 'e0000000-0000-0000-0000-000000000002';
const CONTACT3_ID = 'e0000000-0000-0000-0000-000000000003';
const CONTACT4_ID = 'e0000000-0000-0000-0000-000000000004';
const CONTACT5_ID = 'e0000000-0000-0000-0000-000000000005';

const TAG1_ID = 'aa000000-0000-0000-0000-000000000001';
const TAG2_ID = 'aa000000-0000-0000-0000-000000000002';
const TAG3_ID = 'aa000000-0000-0000-0000-000000000003';
const TAG4_ID = 'aa000000-0000-0000-0000-000000000004';
const TAG5_ID = 'aa000000-0000-0000-0000-000000000005';
const TAG6_ID = 'aa000000-0000-0000-0000-000000000006';
const TAG7_ID = 'aa000000-0000-0000-0000-000000000007';
const TAG8_ID = 'aa000000-0000-0000-0000-000000000008';

const CONV1_ID = 'f0000000-0000-0000-0000-000000000001';
const CONV2_ID = 'f0000000-0000-0000-0000-000000000002';
const CONV3_ID = 'f0000000-0000-0000-0000-000000000003';
const CONV4_ID = 'f0000000-0000-0000-0000-000000000004';
const CONV5_ID = 'f0000000-0000-0000-0000-000000000005';

const CASE1_ID = 'a1000000-0000-0000-0000-000000000001';
const CASE2_ID = 'a1000000-0000-0000-0000-000000000002';
const CASE3_ID = 'a1000000-0000-0000-0000-000000000003';

const SLA1_ID = 'a2000000-0000-0000-0000-000000000001';
const SLA2_ID = 'a2000000-0000-0000-0000-000000000002';
const SLA3_ID = 'a2000000-0000-0000-0000-000000000003';
const SLA4_ID = 'a2000000-0000-0000-0000-000000000004';

const RULE1_ID = 'a3000000-0000-0000-0000-000000000001';
const RULE2_ID = 'a3000000-0000-0000-0000-000000000002';

const CI1_ID = 'ca000000-0000-0000-0000-000000000001';
const CI2_ID = 'ca000000-0000-0000-0000-000000000002';
const CI3_ID = 'ca000000-0000-0000-0000-000000000003';
const CI4_ID = 'ca000000-0000-0000-0000-000000000004';
const CI5_ID = 'ca000000-0000-0000-0000-000000000005';
const CI6_ID = 'ca000000-0000-0000-0000-000000000006';

const CT1_ID = 'cb000000-0000-0000-0000-000000000001';
const CT2_ID = 'cb000000-0000-0000-0000-000000000002';
const CT3_ID = 'cb000000-0000-0000-0000-000000000003';
const CT4_ID = 'cb000000-0000-0000-0000-000000000004';
const CT5_ID = 'cb000000-0000-0000-0000-000000000005';

const CA1_ID = 'cc000000-0000-0000-0000-000000000001';
const CA2_ID = 'cc000000-0000-0000-0000-000000000002';
const CA3_ID = 'cc000000-0000-0000-0000-000000000003';

const MSG_PREFIX = 'dd000000-0000-0000-0000-';

const CE1_ID = 'ce000000-0000-0000-0000-000000000001';
const CE2_ID = 'ce000000-0000-0000-0000-000000000002';
const CE3_ID = 'ce000000-0000-0000-0000-000000000003';
const CE4_ID = 'ce000000-0000-0000-0000-000000000004';
const CE5_ID = 'ce000000-0000-0000-0000-000000000005';
const CE6_ID = 'ce000000-0000-0000-0000-000000000006';
const CE7_ID = 'ce000000-0000-0000-0000-000000000007';

const CN1_ID = 'cf000000-0000-0000-0000-000000000001';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date();

function minutesAgo(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function hoursFromNow(hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function msgId(seq: number): string {
  return `${MSG_PREFIX}${String(seq).padStart(12, '0')}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding open333CRM demo data...\n');

  // ── Agents ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 10);

  const agentData = [
    { id: ADMIN_ID, email: 'admin@demo.com', name: '林芳', role: 'ADMIN' as const },
    { id: SUPERVISOR_ID, email: 'supervisor@demo.com', name: '陳主任', role: 'SUPERVISOR' as const },
    { id: AGENT_ID, email: 'agent1@demo.com', name: '王小華', role: 'AGENT' as const },
  ];

  for (const a of agentData) {
    await prisma.agent.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: a.email } },
      update: { name: a.name, role: a.role, passwordHash, isActive: true },
      create: {
        id: a.id,
        tenantId: TENANT_ID,
        email: a.email,
        name: a.name,
        role: a.role,
        passwordHash,
        isActive: true,
      },
    });
  }
  console.log('  [OK] Agents (3)');

  // ── Team ────────────────────────────────────────────────────────────────────
  await prisma.team.upsert({
    where: { id: TEAM_ID },
    update: { name: '客服一部' },
    create: { id: TEAM_ID, tenantId: TENANT_ID, name: '客服一部' },
  });

  // Link all agents to team (upsert via deleteMany + createMany for composite key)
  for (const agentId of [ADMIN_ID, SUPERVISOR_ID, AGENT_ID]) {
    await prisma.agentTeamMember.upsert({
      where: { agentId_teamId: { agentId, teamId: TEAM_ID } },
      update: {},
      create: { agentId, teamId: TEAM_ID },
    });
  }
  console.log('  [OK] Team + members (1 team, 3 members)');

  // ── Channels ────────────────────────────────────────────────────────────────
  const channelData = [
    { id: LINE_CHANNEL_ID, channelType: 'LINE' as const, displayName: 'Demo LINE OA' },
    { id: FB_CHANNEL_ID, channelType: 'FB' as const, displayName: 'Demo Facebook' },
    { id: WEBCHAT_CHANNEL_ID, channelType: 'WEBCHAT' as const, displayName: '網站客服' },
  ];

  for (const ch of channelData) {
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: { displayName: ch.displayName, channelType: ch.channelType, isActive: true },
      create: {
        id: ch.id,
        tenantId: TENANT_ID,
        channelType: ch.channelType,
        displayName: ch.displayName,
        isActive: true,
        credentialsEncrypted: '{"mock":"true"}',
        settings: {},
      },
    });
  }
  console.log('  [OK] Channels (3)');

  // ── Contacts ────────────────────────────────────────────────────────────────
  const contactData = [
    { id: CONTACT1_ID, displayName: '王小美', phone: '0912345678', email: 'wang@example.com' },
    { id: CONTACT2_ID, displayName: '張大明', phone: '0923456789', email: null },
    { id: CONTACT3_ID, displayName: '陳小芳', phone: null, email: 'chen@example.com' },
    { id: CONTACT4_ID, displayName: '李志豪', phone: '0934567890', email: null },
    { id: CONTACT5_ID, displayName: '黃佳豪', phone: null, email: 'huang@example.com' },
  ];

  for (const c of contactData) {
    await prisma.contact.upsert({
      where: { id: c.id },
      update: { displayName: c.displayName, phone: c.phone, email: c.email },
      create: {
        id: c.id,
        tenantId: TENANT_ID,
        displayName: c.displayName,
        phone: c.phone,
        email: c.email,
        language: 'zh-TW',
      },
    });
  }
  console.log('  [OK] Contacts (5)');

  // ── Channel Identities ──────────────────────────────────────────────────────
  const ciData = [
    { id: CI1_ID, contactId: CONTACT1_ID, channelId: LINE_CHANNEL_ID, channelType: 'LINE' as const, uid: 'line-user-wang', profileName: '王小美' },
    { id: CI2_ID, contactId: CONTACT1_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const, uid: 'fb-user-wang', profileName: '王小美' },
    { id: CI3_ID, contactId: CONTACT2_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const, uid: 'fb-user-zhang', profileName: '張大明' },
    { id: CI4_ID, contactId: CONTACT3_ID, channelId: WEBCHAT_CHANNEL_ID, channelType: 'WEBCHAT' as const, uid: 'webchat-user-chen', profileName: '陳小芳' },
    { id: CI5_ID, contactId: CONTACT4_ID, channelId: LINE_CHANNEL_ID, channelType: 'LINE' as const, uid: 'line-user-li', profileName: '李志豪' },
    { id: CI6_ID, contactId: CONTACT5_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const, uid: 'fb-user-huang', profileName: '黃佳豪' },
  ];

  for (const ci of ciData) {
    await prisma.channelIdentity.upsert({
      where: { channelId_uid: { channelId: ci.channelId, uid: ci.uid } },
      update: { profileName: ci.profileName },
      create: {
        id: ci.id,
        contactId: ci.contactId,
        channelId: ci.channelId,
        channelType: ci.channelType,
        uid: ci.uid,
        profileName: ci.profileName,
      },
    });
  }
  console.log('  [OK] Channel Identities (6)');

  // ── Tags ────────────────────────────────────────────────────────────────────
  const tagData = [
    { id: TAG1_ID, name: 'VIP', type: 'MANUAL' as const, scope: 'CONTACT' as const, color: '#ef4444', description: 'VIP 重要客戶' },
    { id: TAG2_ID, name: '冰箱客戶', type: 'AUTO' as const, scope: 'CONTACT' as const, color: '#3b82f6', description: '購買過冰箱產品的客戶' },
    { id: TAG3_ID, name: '保固中', type: 'SYSTEM' as const, scope: 'CONTACT' as const, color: '#22c55e', description: '產品仍在保固期內' },
    { id: TAG4_ID, name: '新用戶', type: 'AUTO' as const, scope: 'CONTACT' as const, color: '#a855f7', description: '近 30 天內建立的客戶' },
    { id: TAG5_ID, name: '洗衣機客戶', type: 'MANUAL' as const, scope: 'CONTACT' as const, color: '#f97316', description: '購買過洗衣機產品的客戶' },
    { id: TAG6_ID, name: 'LINE好友', type: 'CHANNEL' as const, scope: 'CONTACT' as const, color: '#06b6d4', description: '透過 LINE 管道聯繫的客戶' },
    { id: TAG7_ID, name: '客訴', type: 'MANUAL' as const, scope: 'CASE' as const, color: '#dc2626', description: '客戶投訴案件' },
    { id: TAG8_ID, name: '緊急', type: 'SYSTEM' as const, scope: 'CASE' as const, color: '#b91c1c', description: '需要緊急處理的案件' },
  ];

  for (const t of tagData) {
    await prisma.tag.upsert({
      where: { tenantId_name_scope: { tenantId: TENANT_ID, name: t.name, scope: t.scope } },
      update: { color: t.color, type: t.type, description: t.description },
      create: {
        id: t.id,
        tenantId: TENANT_ID,
        name: t.name,
        type: t.type,
        scope: t.scope,
        color: t.color,
        description: t.description,
      },
    });
  }
  console.log('  [OK] Tags (8)');

  // ── Contact Tags ────────────────────────────────────────────────────────────
  const contactTagData = [
    { id: CT1_ID, contactId: CONTACT1_ID, tagId: TAG1_ID, addedBy: 'agent', addedById: AGENT_ID },
    { id: CT2_ID, contactId: CONTACT1_ID, tagId: TAG2_ID, addedBy: 'system', addedById: null },
    { id: CT3_ID, contactId: CONTACT1_ID, tagId: TAG3_ID, addedBy: 'system', addedById: null },
    { id: CT4_ID, contactId: CONTACT2_ID, tagId: TAG5_ID, addedBy: 'agent', addedById: AGENT_ID },
    { id: CT5_ID, contactId: CONTACT4_ID, tagId: TAG6_ID, addedBy: 'system', addedById: null },
  ];

  for (const ct of contactTagData) {
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: ct.contactId, tagId: ct.tagId } },
      update: {},
      create: {
        id: ct.id,
        contactId: ct.contactId,
        tagId: ct.tagId,
        addedBy: ct.addedBy,
        addedById: ct.addedById,
      },
    });
  }

  // Contact4 also gets TAG4 (新用戶)
  const CT6_ID = 'cb000000-0000-0000-0000-000000000006';
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: CONTACT4_ID, tagId: TAG4_ID } },
    update: {},
    create: {
      id: CT6_ID,
      contactId: CONTACT4_ID,
      tagId: TAG4_ID,
      addedBy: 'system',
      addedById: null,
    },
  });
  console.log('  [OK] Contact Tags (6)');

  // ── Contact Attributes ──────────────────────────────────────────────────────
  const attrData = [
    { id: CA1_ID, contactId: CONTACT1_ID, key: 'brand', value: 'Samsung', dataType: 'string' },
    { id: CA2_ID, contactId: CONTACT1_ID, key: 'model', value: 'RF90K', dataType: 'string' },
    { id: CA3_ID, contactId: CONTACT1_ID, key: 'purchaseDate', value: '2023-03-01', dataType: 'date' },
  ];

  for (const attr of attrData) {
    await prisma.contactAttribute.upsert({
      where: { contactId_key: { contactId: attr.contactId, key: attr.key } },
      update: { value: attr.value, dataType: attr.dataType },
      create: {
        id: attr.id,
        contactId: attr.contactId,
        key: attr.key,
        value: attr.value,
        dataType: attr.dataType,
      },
    });
  }
  console.log('  [OK] Contact Attributes (3)');

  // ── SLA Policies ────────────────────────────────────────────────────────────
  const slaData = [
    { id: SLA1_ID, name: '低優先', priority: 'LOW' as const, firstResponseMinutes: 480, resolutionMinutes: 4320, warningBeforeMinutes: 60, isDefault: false },
    { id: SLA2_ID, name: '中優先', priority: 'MEDIUM' as const, firstResponseMinutes: 240, resolutionMinutes: 1440, warningBeforeMinutes: 30, isDefault: true },
    { id: SLA3_ID, name: '高優先', priority: 'HIGH' as const, firstResponseMinutes: 60, resolutionMinutes: 240, warningBeforeMinutes: 15, isDefault: false },
    { id: SLA4_ID, name: '緊急', priority: 'URGENT' as const, firstResponseMinutes: 15, resolutionMinutes: 60, warningBeforeMinutes: 5, isDefault: false },
  ];

  for (const sla of slaData) {
    await prisma.slaPolicy.upsert({
      where: { id: sla.id },
      update: {
        name: sla.name,
        priority: sla.priority,
        firstResponseMinutes: sla.firstResponseMinutes,
        resolutionMinutes: sla.resolutionMinutes,
        warningBeforeMinutes: sla.warningBeforeMinutes,
        isDefault: sla.isDefault,
      },
      create: {
        id: sla.id,
        tenantId: TENANT_ID,
        name: sla.name,
        priority: sla.priority,
        firstResponseMinutes: sla.firstResponseMinutes,
        resolutionMinutes: sla.resolutionMinutes,
        warningBeforeMinutes: sla.warningBeforeMinutes,
        isDefault: sla.isDefault,
      },
    });
  }
  console.log('  [OK] SLA Policies (4)');

  // ── Conversations ───────────────────────────────────────────────────────────
  // We create conversations first without caseId, then link after cases are created.

  const conv1LastMsg = minutesAgo(110); // ~2 hours ago, last message
  const conv2LastMsg = minutesAgo(30);
  const conv3LastMsg = minutesAgo(55);
  const conv4LastMsg = daysAgo(2);
  const conv5LastMsg = minutesAgo(10);

  const convData = [
    {
      id: CONV1_ID, contactId: CONTACT1_ID, channelId: LINE_CHANNEL_ID, channelType: 'LINE' as const,
      status: 'AGENT_HANDLED' as const, assignedToId: AGENT_ID, unreadCount: 0, lastMessageAt: conv1LastMsg,
    },
    {
      id: CONV2_ID, contactId: CONTACT2_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const,
      status: 'ACTIVE' as const, assignedToId: null, unreadCount: 3, lastMessageAt: conv2LastMsg,
    },
    {
      id: CONV3_ID, contactId: CONTACT3_ID, channelId: WEBCHAT_CHANNEL_ID, channelType: 'WEBCHAT' as const,
      status: 'ACTIVE' as const, assignedToId: null, unreadCount: 2, lastMessageAt: conv3LastMsg,
    },
    {
      id: CONV4_ID, contactId: CONTACT4_ID, channelId: LINE_CHANNEL_ID, channelType: 'LINE' as const,
      status: 'CLOSED' as const, assignedToId: null, unreadCount: 0, lastMessageAt: conv4LastMsg,
    },
    {
      id: CONV5_ID, contactId: CONTACT5_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const,
      status: 'ACTIVE' as const, assignedToId: null, unreadCount: 3, lastMessageAt: conv5LastMsg,
    },
  ];

  for (const conv of convData) {
    await prisma.conversation.upsert({
      where: { id: conv.id },
      update: {
        status: conv.status,
        assignedToId: conv.assignedToId,
        unreadCount: conv.unreadCount,
        lastMessageAt: conv.lastMessageAt,
      },
      create: {
        id: conv.id,
        tenantId: TENANT_ID,
        contactId: conv.contactId,
        channelId: conv.channelId,
        channelType: conv.channelType,
        status: conv.status,
        assignedToId: conv.assignedToId,
        unreadCount: conv.unreadCount,
        lastMessageAt: conv.lastMessageAt,
      },
    });
  }
  console.log('  [OK] Conversations (5)');

  // ── Messages ────────────────────────────────────────────────────────────────
  // Conv1: 6 messages, refrigerator problem, starting ~2 hours ago
  const conv1Messages = [
    {
      id: msgId(1), conversationId: CONV1_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '你好，我家的冰箱從昨天開始就不太冷了，請問可以幫忙處理嗎？' },
      isRead: true, createdAt: minutesAgo(120),
    },
    {
      id: msgId(2), conversationId: CONV1_ID, direction: 'OUTBOUND' as const, senderType: 'AGENT' as const,
      senderId: AGENT_ID, contentType: 'text', content: { text: '王小姐您好！感謝您的來訊。請問您的冰箱型號是什麼呢？大概使用多久了？' },
      isRead: true, createdAt: minutesAgo(118),
    },
    {
      id: msgId(3), conversationId: CONV1_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '型號是 Samsung RF90K，買了大概兩年多' },
      isRead: true, createdAt: minutesAgo(116),
    },
    {
      id: msgId(4), conversationId: CONV1_ID, direction: 'OUTBOUND' as const, senderType: 'AGENT' as const,
      senderId: AGENT_ID, contentType: 'text', content: { text: '好的，RF90K 還在三年保固期內。我先幫您建立維修工單，會安排技師盡快與您聯繫。' },
      isRead: true, createdAt: minutesAgo(114),
    },
    {
      id: msgId(5), conversationId: CONV1_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '好的謝謝你，大概什麼時候會有人聯繫我呢？' },
      isRead: true, createdAt: minutesAgo(112),
    },
    {
      id: msgId(6), conversationId: CONV1_ID, direction: 'OUTBOUND' as const, senderType: 'AGENT' as const,
      senderId: AGENT_ID, contentType: 'text', content: { text: '通常 24 小時內會有技師主動致電，我已經把您列為優先處理。有任何問題隨時跟我們說！' },
      isRead: true, createdAt: minutesAgo(110),
    },
  ];

  // Conv2: 4 messages, washing machine warranty, starting ~30 min ago
  const conv2Messages = [
    {
      id: msgId(7), conversationId: CONV2_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '我想問一下，我去年買的洗衣機保固到什麼時候？' },
      isRead: false, createdAt: minutesAgo(30),
    },
    {
      id: msgId(8), conversationId: CONV2_ID, direction: 'OUTBOUND' as const, senderType: 'BOT' as const,
      senderId: null, contentType: 'text', content: { text: '您好！歡迎使用客服系統。正在為您轉接客服人員...' },
      isRead: true, createdAt: minutesAgo(29),
    },
    {
      id: msgId(9), conversationId: CONV2_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '可以快點嗎？我有點急' },
      isRead: false, createdAt: minutesAgo(25),
    },
    {
      id: msgId(10), conversationId: CONV2_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '？？有人嗎' },
      isRead: false, createdAt: minutesAgo(20),
    },
  ];

  // Conv3: 3 messages, extended warranty, starting ~1 hour ago
  const conv3Messages = [
    {
      id: msgId(11), conversationId: CONV3_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '請問有沒有延長保固的方案？' },
      isRead: false, createdAt: minutesAgo(60),
    },
    {
      id: msgId(12), conversationId: CONV3_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '我有一台洗碗機想要加購延保' },
      isRead: false, createdAt: minutesAgo(58),
    },
    {
      id: msgId(13), conversationId: CONV3_ID, direction: 'OUTBOUND' as const, senderType: 'SYSTEM' as const,
      senderId: null, contentType: 'text', content: { text: '感謝您的詢問，我們的客服人員將盡快為您服務。' },
      isRead: true, createdAt: minutesAgo(55),
    },
  ];

  // Conv4: 5 messages, completed repair booking, starting ~2 days ago
  const conv4Messages = [
    {
      id: msgId(14), conversationId: CONV4_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '我想預約維修冷氣' },
      isRead: true, createdAt: new Date(daysAgo(2).getTime()),
    },
    {
      id: msgId(15), conversationId: CONV4_ID, direction: 'OUTBOUND' as const, senderType: 'AGENT' as const,
      senderId: AGENT_ID, contentType: 'text', content: { text: '李先生您好，請問方便告訴我您的冷氣品牌和遇到的問題嗎？' },
      isRead: true, createdAt: new Date(daysAgo(2).getTime() + 3 * 60 * 1000),
    },
    {
      id: msgId(16), conversationId: CONV4_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '大金的，開機後會發出怪聲音' },
      isRead: true, createdAt: new Date(daysAgo(2).getTime() + 5 * 60 * 1000),
    },
    {
      id: msgId(17), conversationId: CONV4_ID, direction: 'OUTBOUND' as const, senderType: 'AGENT' as const,
      senderId: AGENT_ID, contentType: 'text', content: { text: '了解，我已經幫您安排本週五下午 2-4 點的維修時段，技師會提前致電確認。' },
      isRead: true, createdAt: new Date(daysAgo(2).getTime() + 8 * 60 * 1000),
    },
    {
      id: msgId(18), conversationId: CONV4_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '太好了，謝謝！' },
      isRead: true, createdAt: new Date(daysAgo(2).getTime() + 10 * 60 * 1000),
    },
  ];

  // Conv5: 3 messages, complaint, starting ~10 min ago
  const conv5Messages = [
    {
      id: msgId(19), conversationId: CONV5_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '你們的售後服務也太差了吧！修了三次都沒修好！' },
      isRead: false, createdAt: minutesAgo(10),
    },
    {
      id: msgId(20), conversationId: CONV5_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '我要投訴！請你們主管跟我聯繫！' },
      isRead: false, createdAt: minutesAgo(8),
    },
    {
      id: msgId(21), conversationId: CONV5_ID, direction: 'INBOUND' as const, senderType: 'CONTACT' as const,
      senderId: null, contentType: 'text', content: { text: '再不處理我就去消保會檢舉' },
      isRead: false, createdAt: minutesAgo(5),
    },
  ];

  const allMessages = [
    ...conv1Messages,
    ...conv2Messages,
    ...conv3Messages,
    ...conv4Messages,
    ...conv5Messages,
  ];

  for (const msg of allMessages) {
    await prisma.message.upsert({
      where: { id: msg.id },
      update: {
        direction: msg.direction,
        senderType: msg.senderType,
        senderId: msg.senderId,
        contentType: msg.contentType,
        content: msg.content,
        isRead: msg.isRead,
      },
      create: {
        id: msg.id,
        conversationId: msg.conversationId,
        direction: msg.direction,
        senderType: msg.senderType,
        senderId: msg.senderId,
        contentType: msg.contentType,
        content: msg.content,
        isRead: msg.isRead,
        createdAt: msg.createdAt,
      },
    });
  }
  console.log('  [OK] Messages (21)');

  // ── Cases ───────────────────────────────────────────────────────────────────
  const caseData = [
    {
      id: CASE1_ID,
      contactId: CONTACT1_ID,
      channelId: LINE_CHANNEL_ID,
      title: '冰箱不製冷維修',
      description: '客戶反映 Samsung RF90K 冰箱不製冷，需安排維修技師到府檢修。產品尚在三年保固期內。',
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      category: '維修',
      assigneeId: AGENT_ID,
      teamId: TEAM_ID,
      slaPolicy: '高優先',
      slaDueAt: hoursFromNow(4),
      resolvedAt: null,
      closedAt: null,
    },
    {
      id: CASE2_ID,
      contactId: CONTACT2_ID,
      channelId: FB_CHANNEL_ID,
      title: '洗衣機噪音問題',
      description: '客戶詢問洗衣機保固狀態，產品有噪音問題待處理。',
      status: 'OPEN' as const,
      priority: 'MEDIUM' as const,
      category: '維修',
      assigneeId: null,
      teamId: null,
      slaPolicy: '中優先',
      slaDueAt: null,
      resolvedAt: null,
      closedAt: null,
    },
    {
      id: CASE3_ID,
      contactId: CONTACT4_ID,
      channelId: LINE_CHANNEL_ID,
      title: '保固查詢',
      description: '客戶查詢大金冷氣保固資訊並預約維修，已安排維修時段。',
      status: 'RESOLVED' as const,
      priority: 'LOW' as const,
      category: '查詢',
      assigneeId: AGENT_ID,
      teamId: TEAM_ID,
      slaPolicy: '低優先',
      slaDueAt: null,
      resolvedAt: daysAgo(1),
      closedAt: null,
    },
  ];

  for (const c of caseData) {
    await prisma.case.upsert({
      where: { id: c.id },
      update: {
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        category: c.category,
        assigneeId: c.assigneeId,
        teamId: c.teamId,
        slaPolicy: c.slaPolicy,
        slaDueAt: c.slaDueAt,
        resolvedAt: c.resolvedAt,
        closedAt: c.closedAt,
      },
      create: {
        id: c.id,
        tenantId: TENANT_ID,
        contactId: c.contactId,
        channelId: c.channelId,
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        category: c.category,
        assigneeId: c.assigneeId,
        teamId: c.teamId,
        slaPolicy: c.slaPolicy,
        slaDueAt: c.slaDueAt,
        resolvedAt: c.resolvedAt,
        closedAt: c.closedAt,
      },
    });
  }
  console.log('  [OK] Cases (3)');

  // ── Link Conversations to Cases ─────────────────────────────────────────────
  // Conv1 -> Case1, Conv4 -> Case3
  await prisma.conversation.update({
    where: { id: CONV1_ID },
    data: { caseId: CASE1_ID },
  });
  await prisma.conversation.update({
    where: { id: CONV4_ID },
    data: { caseId: CASE3_ID },
  });
  console.log('  [OK] Conversation-Case links (2)');

  // ── Case Events ─────────────────────────────────────────────────────────────
  const caseEventData = [
    // Case1 events
    {
      id: CE1_ID, caseId: CASE1_ID, actorType: 'system', actorId: null,
      eventType: 'created', payload: { title: '冰箱不製冷維修', priority: 'HIGH' },
      createdAt: minutesAgo(115),
    },
    {
      id: CE2_ID, caseId: CASE1_ID, actorType: 'agent', actorId: SUPERVISOR_ID,
      eventType: 'assigned', payload: { assigneeId: AGENT_ID, assigneeName: '王小華' },
      createdAt: minutesAgo(114),
    },
    {
      id: CE3_ID, caseId: CASE1_ID, actorType: 'agent', actorId: AGENT_ID,
      eventType: 'status_changed', payload: { from: 'OPEN', to: 'IN_PROGRESS' },
      createdAt: minutesAgo(113),
    },
    // Case2 events
    {
      id: CE4_ID, caseId: CASE2_ID, actorType: 'system', actorId: null,
      eventType: 'created', payload: { title: '洗衣機噪音問題', priority: 'MEDIUM' },
      createdAt: minutesAgo(28),
    },
    // Case3 events
    {
      id: CE5_ID, caseId: CASE3_ID, actorType: 'system', actorId: null,
      eventType: 'created', payload: { title: '保固查詢', priority: 'LOW' },
      createdAt: new Date(daysAgo(2).getTime()),
    },
    {
      id: CE6_ID, caseId: CASE3_ID, actorType: 'agent', actorId: SUPERVISOR_ID,
      eventType: 'assigned', payload: { assigneeId: AGENT_ID, assigneeName: '王小華' },
      createdAt: new Date(daysAgo(2).getTime() + 2 * 60 * 1000),
    },
    {
      id: CE7_ID, caseId: CASE3_ID, actorType: 'agent', actorId: AGENT_ID,
      eventType: 'status_changed', payload: { from: 'OPEN', to: 'IN_PROGRESS' },
      createdAt: new Date(daysAgo(2).getTime() + 3 * 60 * 1000),
    },
  ];

  // Case3 additional event: status_changed to RESOLVED
  const CE8_ID = 'ce000000-0000-0000-0000-000000000008';
  caseEventData.push({
    id: CE8_ID, caseId: CASE3_ID, actorType: 'agent', actorId: AGENT_ID,
    eventType: 'status_changed', payload: { from: 'IN_PROGRESS', to: 'RESOLVED' },
    createdAt: daysAgo(1),
  });

  for (const ce of caseEventData) {
    await prisma.caseEvent.upsert({
      where: { id: ce.id },
      update: {
        actorType: ce.actorType,
        actorId: ce.actorId,
        eventType: ce.eventType,
        payload: ce.payload,
      },
      create: {
        id: ce.id,
        caseId: ce.caseId,
        actorType: ce.actorType,
        actorId: ce.actorId,
        eventType: ce.eventType,
        payload: ce.payload,
        createdAt: ce.createdAt,
      },
    });
  }
  console.log('  [OK] Case Events (8)');

  // ── Case Notes ──────────────────────────────────────────────────────────────
  await prisma.caseNote.upsert({
    where: { id: CN1_ID },
    update: {
      content: '客戶冰箱型號 RF90K，保固期內，需安排維修技師',
      isInternal: true,
    },
    create: {
      id: CN1_ID,
      caseId: CASE1_ID,
      agentId: AGENT_ID,
      content: '客戶冰箱型號 RF90K，保固期內，需安排維修技師',
      isInternal: true,
    },
  });
  console.log('  [OK] Case Notes (1)');

  // ── Automation Rules ────────────────────────────────────────────────────────
  await prisma.automationRule.upsert({
    where: { id: RULE1_ID },
    update: {
      name: '故障關鍵字自動開案',
      description: '當客戶訊息包含「故障」關鍵字時，自動建立維修案件並加上客訴標籤',
      isActive: true,
      priority: 10,
      stopOnMatch: false,
      trigger: { type: 'message.received' },
      conditions: {
        all: [
          { fact: 'message.text', operator: 'contains', value: '故障' },
        ],
      },
      actions: [
        {
          type: 'create_case',
          params: {
            title: '自動開案：客戶提報故障',
            priority: 'HIGH',
            category: '維修',
          },
        },
        {
          type: 'add_tag',
          params: { tagName: '客訴' },
        },
      ],
    },
    create: {
      id: RULE1_ID,
      tenantId: TENANT_ID,
      name: '故障關鍵字自動開案',
      description: '當客戶訊息包含「故障」關鍵字時，自動建立維修案件並加上客訴標籤',
      isActive: true,
      priority: 10,
      stopOnMatch: false,
      trigger: { type: 'message.received' },
      conditions: {
        all: [
          { fact: 'message.text', operator: 'contains', value: '故障' },
        ],
      },
      actions: [
        {
          type: 'create_case',
          params: {
            title: '自動開案：客戶提報故障',
            priority: 'HIGH',
            category: '維修',
          },
        },
        {
          type: 'add_tag',
          params: { tagName: '客訴' },
        },
      ],
      runCount: 0,
    },
  });

  await prisma.automationRule.upsert({
    where: { id: RULE2_ID },
    update: {
      name: 'VIP 客戶投訴自動升級',
      description: '當 VIP 客戶訊息包含「投訴」或「檢舉」時，自動建立緊急案件並通知主管',
      isActive: true,
      priority: 100,
      stopOnMatch: true,
      trigger: { type: 'message.received' },
      conditions: {
        all: [
          { fact: 'is_vip_customer', operator: 'equal', value: true },
          {
            any: [
              { fact: 'message.text', operator: 'contains', value: '投訴' },
              { fact: 'message.text', operator: 'contains', value: '檢舉' },
            ],
          },
        ],
      },
      actions: [
        {
          type: 'create_case',
          params: {
            title: 'VIP客訴自動升級案件',
            priority: 'URGENT',
            category: '客訴',
          },
        },
        {
          type: 'notify_supervisor',
          params: { message: 'VIP客戶投訴，請立即處理' },
        },
      ],
    },
    create: {
      id: RULE2_ID,
      tenantId: TENANT_ID,
      name: 'VIP 客戶投訴自動升級',
      description: '當 VIP 客戶訊息包含「投訴」或「檢舉」時，自動建立緊急案件並通知主管',
      isActive: true,
      priority: 100,
      stopOnMatch: true,
      trigger: { type: 'message.received' },
      conditions: {
        all: [
          { fact: 'is_vip_customer', operator: 'equal', value: true },
          {
            any: [
              { fact: 'message.text', operator: 'contains', value: '投訴' },
              { fact: 'message.text', operator: 'contains', value: '檢舉' },
            ],
          },
        ],
      },
      actions: [
        {
          type: 'create_case',
          params: {
            title: 'VIP客訴自動升級案件',
            priority: 'URGENT',
            category: '客訴',
          },
        },
        {
          type: 'notify_supervisor',
          params: { message: 'VIP客戶投訴，請立即處理' },
        },
      ],
      runCount: 0,
    },
  });
  console.log('  [OK] Automation Rules (2)');

  // ── Done ────────────────────────────────────────────────────────────────────
  console.log('\nSeed completed successfully!');
  console.log('─────────────────────────────────────────');
  console.log('  Tenant:              1');
  console.log('  Agents:              3');
  console.log('  Teams:               1');
  console.log('  Channels:            3');
  console.log('  Contacts:            5');
  console.log('  Channel Identities:  6');
  console.log('  Tags:                8');
  console.log('  Contact Tags:        6');
  console.log('  Contact Attributes:  3');
  console.log('  SLA Policies:        4');
  console.log('  Conversations:       5');
  console.log('  Messages:            21');
  console.log('  Cases:               3');
  console.log('  Case Events:         8');
  console.log('  Case Notes:          1');
  console.log('  Automation Rules:    2');
  console.log('─────────────────────────────────────────');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
