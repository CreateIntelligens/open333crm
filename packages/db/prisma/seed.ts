import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

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
const RULE3_ID = 'a3000000-0000-0000-0000-000000000003';
const RULE4_ID = 'a3000000-0000-0000-0000-000000000004';
const RULE5_ID = 'a3000000-0000-0000-0000-000000000005';
const RULE6_ID = 'a3000000-0000-0000-0000-000000000006';
const RULE7_ID = 'a3000000-0000-0000-0000-000000000007';

// KB Articles
const KB1_ID = 'ea000000-0000-0000-0000-000000000001';
const KB2_ID = 'ea000000-0000-0000-0000-000000000002';
const KB3_ID = 'ea000000-0000-0000-0000-000000000003';
const KB4_ID = 'ea000000-0000-0000-0000-000000000004';
const KB5_ID = 'ea000000-0000-0000-0000-000000000005';
const KB6_ID = 'ea000000-0000-0000-0000-000000000006';
const KB7_ID = 'ea000000-0000-0000-0000-000000000007';
const KB8_ID = 'ea000000-0000-0000-0000-000000000008';

// Marketing
const SEG1_ID = 'eb000000-0000-0000-0000-000000000001';
const SEG2_ID = 'eb000000-0000-0000-0000-000000000002';
const SEG3_ID = 'eb000000-0000-0000-0000-000000000003';
const CAMP1_ID = 'ec000000-0000-0000-0000-000000000001';
const CAMP2_ID = 'ec000000-0000-0000-0000-000000000002';
const BCAST1_ID = 'ed000000-0000-0000-0000-000000000001';
const BCAST2_ID = 'ed000000-0000-0000-0000-000000000002';
const BCAST3_ID = 'ed000000-0000-0000-0000-000000000003';

// TenantSettings
const TSETTINGS_ID = 'ef000000-0000-0000-0000-000000000001';

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

  // ── Clean up transactional data (order matters due to FK constraints) ──────
  console.log('  [CLEAN] Deleting old transactional data...');
  await prisma.automationLog.deleteMany({});
  await prisma.clickLog.deleteMany({});
  await prisma.pointTransaction.deleteMany({});
  await prisma.portalSubmission.deleteMany({});
  await prisma.portalOption.deleteMany({});
  await prisma.portalField.deleteMany({});
  await prisma.portalActivity.deleteMany({});
  await prisma.shortLink.deleteMany({});
  await prisma.broadcastRecipient.deleteMany({});
  await prisma.broadcast.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.segment.deleteMany({});
  await prisma.caseNote.deleteMany({});
  await prisma.caseEvent.deleteMany({});
  await prisma.case.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.channelIdentity.deleteMany({});
  await prisma.contactAttribute.deleteMany({});
  await prisma.contactTag.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.channel.deleteMany({});
  await prisma.kmArticle.deleteMany({});
  await prisma.automationRule.deleteMany({});
  await prisma.slaPolicy.deleteMany({});
  await prisma.tenantSettings.deleteMany({});
  await prisma.dailyStat.deleteMany({});
  await prisma.webhookDelivery.deleteMany({});
  await prisma.webhookSubscription.deleteMany({});
  // Templates: keep system templates, only clear non-system
  await prisma.messageTemplate.deleteMany({ where: { isSystem: false } });
  console.log('  [OK] Cleanup done');

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
  const botConfig = {
    botMode: 'keyword_then_llm',
    maxBotReplies: 5,
    handoffKeywords: ['真人', '人工', '客服', '轉接'],
    handoffMessage: '稍等，正在為您轉接客服人員，請稍候。',
    offlineGreeting: '感謝您的來訊！目前非營業時間，我們將在營業時間盡速回覆您。',
  };

  const channelData = [
    { id: LINE_CHANNEL_ID, channelType: 'LINE' as const, displayName: 'Demo LINE OA' },
    { id: FB_CHANNEL_ID, channelType: 'FB' as const, displayName: 'Demo Facebook' },
    { id: WEBCHAT_CHANNEL_ID, channelType: 'WEBCHAT' as const, displayName: '網站客服' },
  ];

  for (const ch of channelData) {
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: { displayName: ch.displayName, channelType: ch.channelType, isActive: true, settings: { botConfig } },
      create: {
        id: ch.id,
        tenantId: TENANT_ID,
        channelType: ch.channelType,
        displayName: ch.displayName,
        isActive: true,
        credentialsEncrypted: '{"mock":"true"}',
        settings: { botConfig },
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
      status: 'AGENT_HANDLED' as const, assignedToId: null, unreadCount: 3, lastMessageAt: conv2LastMsg,
    },
    {
      id: CONV3_ID, contactId: CONTACT3_ID, channelId: WEBCHAT_CHANNEL_ID, channelType: 'WEBCHAT' as const,
      status: 'BOT_HANDLED' as const, assignedToId: null, unreadCount: 2, lastMessageAt: conv3LastMsg,
    },
    {
      id: CONV4_ID, contactId: CONTACT4_ID, channelId: LINE_CHANNEL_ID, channelType: 'LINE' as const,
      status: 'CLOSED' as const, assignedToId: null, unreadCount: 0, lastMessageAt: conv4LastMsg,
    },
    {
      id: CONV5_ID, contactId: CONTACT5_ID, channelId: FB_CHANNEL_ID, channelType: 'FB' as const,
      status: 'BOT_HANDLED' as const, assignedToId: null, unreadCount: 3, lastMessageAt: conv5LastMsg,
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
  const automationRules = [
    {
      id: RULE1_ID,
      name: '故障關鍵字自動開案',
      description: '當客戶訊息包含故障相關關鍵字時，自動建立維修案件並加上標籤',
      priority: 10,
      stopOnMatch: false,
      trigger: { type: 'keyword.matched', keywords: ['故障', '壞掉', '不動', '無法使用', '不能用', '當機'], match_mode: 'any' },
      conditions: {},
      actions: [
        { type: 'create_case', params: { title: '自動開案：客戶提報故障', priority: 'HIGH', category: '維修' } },
        { type: 'add_tag', params: { tagName: '客訴' } },
        { type: 'send_message', params: { text: '我已經為您建立維修服務單，將盡快安排技師為您處理。請問方便提供您的產品型號和購買時間嗎？' } },
      ],
    },
    {
      id: RULE2_ID,
      name: 'VIP 客戶投訴自動升級',
      description: '當 VIP 客戶訊息包含「投訴」或「檢舉」時，自動建立緊急案件並通知主管',
      priority: 100,
      stopOnMatch: true,
      trigger: { type: 'keyword.matched', keywords: ['投訴', '檢舉'], match_mode: 'any' },
      conditions: { all: [{ fact: 'is_vip_customer', operator: 'equal', value: true }] },
      actions: [
        { type: 'create_case', params: { title: 'VIP客訴自動升級案件', priority: 'URGENT', category: '客訴' } },
        { type: 'notify_supervisor', params: { message: 'VIP客戶投訴，請立即處理' } },
      ],
    },
    {
      id: RULE3_ID,
      name: '歡迎訊息',
      description: '新對話建立時，自動發送歡迎訊息',
      priority: 10,
      stopOnMatch: false,
      trigger: { type: 'conversation.created' },
      conditions: {},
      actions: [
        { type: 'send_message', params: { text: '您好！歡迎聯繫 Open333 客服 😊 請問有什麼可以幫您的？我是 AI 智能助手，也可以隨時輸入「真人」轉接客服人員。' } },
      ],
    },
    {
      id: RULE4_ID,
      name: '產品諮詢自動回覆',
      description: '當客戶問及保固、維修、退換貨等關鍵字時，自動搜尋知識庫回覆',
      priority: 8,
      stopOnMatch: false,
      trigger: { type: 'keyword.matched', keywords: ['保固', '維修', '退貨', '換貨', '退款', '安裝', '配送', '送貨'], match_mode: 'any' },
      conditions: {},
      actions: [
        { type: 'kb_auto_reply', params: {} },
      ],
    },
    {
      id: RULE5_ID,
      name: '客訴自動開案 + 升級',
      description: '客戶投訴時自動建立高優先工單、加標籤、通知主管',
      priority: 9,
      stopOnMatch: true,
      trigger: { type: 'keyword.matched', keywords: ['投訴', '客訴', '不滿', '太差', '很爛', '糟糕', '生氣', '找主管'], match_mode: 'any' },
      conditions: {},
      actions: [
        { type: 'create_case', params: { title: '客訴處理', priority: 'HIGH', category: '客訴' } },
        { type: 'add_tag', params: { tagName: '客訴' } },
        { type: 'notify_supervisor', params: { message: '有客戶提出投訴，請注意處理' } },
        { type: 'send_message', params: { text: '非常抱歉造成您的不便，我已經為您建立服務案件，將由專人盡速為您處理。' } },
      ],
    },
    {
      id: RULE6_ID,
      name: '一般問題自動開案',
      description: '對話中尚無工單時自動建立諮詢案件並自動派單',
      priority: 3,
      stopOnMatch: false,
      trigger: { type: 'message.received' },
      conditions: { all: [{ fact: 'case.open.count', operator: 'equal', value: 0 }] },
      actions: [
        { type: 'create_case', params: { title: '客戶諮詢', priority: 'MEDIUM', category: '諮詢' } },
        { type: 'auto_assign', params: {} },
      ],
    },
    {
      id: RULE7_ID,
      name: '負面情緒通知',
      description: '偵測到客戶負面情緒時通知主管',
      priority: 7,
      stopOnMatch: false,
      trigger: { type: 'sentiment.negative' },
      conditions: {},
      actions: [
        { type: 'notify_supervisor', params: { message: '偵測到客戶負面情緒，請關注此對話' } },
      ],
    },
  ];

  for (const rule of automationRules) {
    await prisma.automationRule.create({
      data: {
        id: rule.id,
        tenantId: TENANT_ID,
        name: rule.name,
        description: rule.description,
        isActive: true,
        priority: rule.priority,
        stopOnMatch: rule.stopOnMatch,
        trigger: rule.trigger,
        conditions: rule.conditions,
        actions: rule.actions,
        runCount: 0,
      },
    });
  }
  console.log('  [OK] Automation Rules (7)');

  // ── Message Templates (System) ────────────────────────────────────────────
  const systemTemplates = [
    {
      id: 'da000000-0000-0000-0000-000000000001',
      name: '歡迎訊息',
      description: '新客戶首次聯繫時的歡迎訊息',
      category: '一般',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好！歡迎聯繫我們，請問有什麼可以為您服務的嗎？' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000002',
      name: '等候通知',
      description: '客服忙線時的等候通知',
      category: '一般',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，目前客服人員忙線中，我們將盡快為您服務，請稍候。' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000003',
      name: '滿意度調查',
      description: '服務結束後的滿意度調查',
      category: '一般',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，感謝您使用我們的服務！請問您對本次服務的滿意度如何？（1-5 分）' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000004',
      name: '案件建立通知',
      description: '案件建立後通知客戶',
      category: '服務類',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，您的案件已建立。\n案件編號：{{case.id}}\n案件主題：{{case.title}}\n我們將盡快處理，感謝您的耐心等候。' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'case.id', label: '案件編號', required: false },
        { key: 'case.title', label: '案件主題', required: false },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000005',
      name: '案件狀態更新',
      description: '案件狀態變更時通知客戶',
      category: '服務類',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，您的案件狀態已更新。\n案件編號：{{case.id}}\n目前狀態：{{case.status}}\n如有疑問，歡迎隨時聯繫我們。' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'case.id', label: '案件編號', required: false },
        { key: 'case.status', label: '案件狀態', required: false },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000006',
      name: '維修預約確認',
      description: '維修預約成功後的確認訊息',
      category: '服務類',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，您的維修預約已確認。\n案件編號：{{case.id}}\n請於預約時間保持聯繫方式暢通，我們的技術人員將與您聯繫。' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'case.id', label: '案件編號', required: false },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000007',
      name: '保固到期提醒',
      description: '產品保固即將到期的提醒',
      category: '行銷類',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好，您的產品保固即將到期。建議您考慮延長保固服務，享受更完整的售後保障。歡迎聯繫我們了解詳情！' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000008',
      name: '促銷活動通知',
      description: '促銷活動的行銷推播',
      category: '行銷類',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好！我們正在舉辦限時優惠活動，精選商品享有特別折扣。立即前往查看：{{storage.base_url}}/promo' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'storage.base_url', label: '儲存網址', required: false },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000009',
      name: '服務選單',
      description: '提供快速選單讓客戶選擇服務項目',
      category: '互動類',
      contentType: 'quick_reply',
      body: {
        text: '{{contact.name}} 您好！請選擇您需要的服務：',
        quickReplies: [
          { label: '產品諮詢', text: '我想了解產品', postbackData: 'action=inquiry' },
          { label: '維修服務', text: '我需要維修服務', postbackData: 'action=repair' },
          { label: '訂單查詢', text: '我要查詢訂單', postbackData: 'action=order' },
          { label: '聯繫客服', text: '我要聯繫客服', postbackData: 'action=agent' },
        ],
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000000a',
      name: '案件確認卡',
      description: '以 Flex Message 格式顯示案件確認資訊',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '案件確認：{{case.title}}',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '案件確認', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              {
                type: 'box', layout: 'vertical', margin: 'md', contents: [
                  { type: 'text', text: '案件編號：{{case.id}}', size: 'sm', color: '#555555' },
                  { type: 'text', text: '主題：{{case.title}}', size: 'sm', color: '#555555' },
                  { type: 'text', text: '優先級：{{case.priority}}', size: 'sm', color: '#555555' },
                  { type: 'text', text: '狀態：{{case.status}}', size: 'sm', color: '#555555' },
                ],
              },
            ],
          },
        },
      },
      variables: [
        { key: 'case.id', label: '案件編號', required: false },
        { key: 'case.title', label: '案件主題', required: false },
        { key: 'case.priority', label: '優先級', required: false },
        { key: 'case.status', label: '案件狀態', required: false },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000000b',
      name: '產品規格卡',
      description: '以 Flex Message 格式顯示產品規格',
      category: '互動類',
      contentType: 'flex',
      body: {
        text: '產品規格資訊',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '產品規格', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              {
                type: 'box', layout: 'vertical', margin: 'md', contents: [
                  { type: 'text', text: '型號：{{attribute.model}}', size: 'sm' },
                  { type: 'text', text: '規格：{{attribute.spec}}', size: 'sm' },
                  { type: 'text', text: '價格：{{attribute.price}}', size: 'sm' },
                ],
              },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.model', label: '產品型號', required: false, defaultValue: '-' },
        { key: 'attribute.spec', label: '產品規格', required: false, defaultValue: '-' },
        { key: 'attribute.price', label: '產品價格', required: false, defaultValue: '-' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000000c',
      name: '節慶問候',
      description: '節日問候訊息',
      category: '問候',
      contentType: 'text',
      body: { text: '{{contact.name}} 您好！祝您佳節愉快！感謝您一直以來的支持與信賴，我們將持續為您提供最好的服務。' },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    // ── 13–17: 服務類 Flex ──────────────────────────────────────────────────
    {
      id: 'da000000-0000-0000-0000-00000000000d',
      name: '維修進度追蹤',
      description: '以 Flex 卡片顯示維修進度',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '維修進度：{{case.title}}',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '維修進度追蹤', weight: 'bold', size: 'lg', color: '#1DB446' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '案件：{{case.title}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '狀態：{{case.status}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '技師：{{attribute.technician}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '預計完工：{{attribute.eta}}', size: 'sm', color: '#555555' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'case.title', label: '案件主題', required: false },
        { key: 'case.status', label: '案件狀態', required: false },
        { key: 'attribute.technician', label: '技師名稱', required: false, defaultValue: '待指派' },
        { key: 'attribute.eta', label: '預計完工', required: false, defaultValue: '待確認' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000000e',
      name: '維修師傅資訊卡',
      description: '顯示派遣技師的聯繫資訊',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '維修師傅資訊',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '維修師傅資訊', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '姓名：{{attribute.technician}}', size: 'sm' },
                { type: 'text', text: '電話：{{attribute.techPhone}}', size: 'sm' },
                { type: 'text', text: '到府時段：{{attribute.visitTime}}', size: 'sm' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.technician', label: '技師姓名', required: true },
        { key: 'attribute.techPhone', label: '技師電話', required: true },
        { key: 'attribute.visitTime', label: '到府時段', required: true },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000000f',
      name: '預約確認卡',
      description: '服務預約成功的確認卡片',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '預約確認',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '預約確認', weight: 'bold', size: 'lg', color: '#1DB446' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '{{contact.name}} 您好', size: 'sm' },
                { type: 'text', text: '日期：{{attribute.appointmentDate}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '時段：{{attribute.appointmentTime}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '地址：{{attribute.address}}', size: 'sm', color: '#555555' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.appointmentDate', label: '預約日期', required: true },
        { key: 'attribute.appointmentTime', label: '預約時段', required: true },
        { key: 'attribute.address', label: '地址', required: false, defaultValue: '待確認' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000010',
      name: '預約提醒（前一天）',
      description: '預約前一天發送的提醒',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '預約提醒',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '預約提醒', weight: 'bold', size: 'lg', color: '#FF6B6B' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '{{contact.name}} 您好，提醒您明天有預約服務', size: 'sm' },
                { type: 'text', text: '日期：{{attribute.appointmentDate}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '時段：{{attribute.appointmentTime}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '如需更改請提前聯繫我們', size: 'xs', color: '#888888' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.appointmentDate', label: '預約日期', required: true },
        { key: 'attribute.appointmentTime', label: '預約時段', required: true },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000011',
      name: '預約取消確認',
      description: '確認預約已取消',
      category: '服務類',
      contentType: 'flex',
      body: {
        text: '預約取消確認',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '預約取消確認', weight: 'bold', size: 'lg', color: '#888888' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '{{contact.name}} 您好，您的預約已取消。', size: 'sm' },
                { type: 'text', text: '原預約日期：{{attribute.appointmentDate}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '如需重新預約，歡迎隨時聯繫我們。', size: 'xs', color: '#888888' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.appointmentDate', label: '原預約日期', required: false },
      ],
    },
    // ── 18–22: 行銷類 Flex ──────────────────────────────────────────────────
    {
      id: 'da000000-0000-0000-0000-000000000012',
      name: '新品上市公告',
      description: '新產品上市推播',
      category: '行銷類',
      contentType: 'flex',
      body: {
        text: '新品上市：{{attribute.productName}}',
        flexJson: {
          type: 'bubble',
          hero: {
            type: 'image', url: '{{attribute.imageUrl}}', size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
          },
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '{{attribute.productName}}', weight: 'bold', size: 'xl' },
              { type: 'text', text: '{{attribute.productDesc}}', size: 'sm', color: '#555555', margin: 'md', wrap: true },
              { type: 'text', text: '售價 NT$ {{attribute.price}}', size: 'lg', color: '#1DB446', weight: 'bold', margin: 'md' },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.productName', label: '產品名稱', required: true },
        { key: 'attribute.productDesc', label: '產品描述', required: false, defaultValue: '全新上市' },
        { key: 'attribute.price', label: '售價', required: true },
        { key: 'attribute.imageUrl', label: '圖片網址', required: false, defaultValue: 'https://placehold.co/600x400' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000013',
      name: '限時優惠 Banner',
      description: '限時促銷的推播卡片',
      category: '行銷類',
      contentType: 'flex',
      body: {
        text: '限時優惠！{{attribute.promoTitle}}',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '限時優惠', weight: 'bold', size: 'xl', color: '#FF0000' },
              { type: 'text', text: '{{attribute.promoTitle}}', size: 'lg', weight: 'bold', margin: 'md' },
              { type: 'text', text: '{{attribute.promoDesc}}', size: 'sm', color: '#555555', margin: 'sm', wrap: true },
              { type: 'text', text: '活動期間：{{attribute.promoDate}}', size: 'xs', color: '#888888', margin: 'md' },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.promoTitle', label: '活動標題', required: true },
        { key: 'attribute.promoDesc', label: '活動描述', required: false, defaultValue: '詳情請洽客服' },
        { key: 'attribute.promoDate', label: '活動期間', required: false, defaultValue: '即日起' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000014',
      name: '延伸保固方案介紹',
      description: '延長保固的推銷卡片',
      category: '行銷類',
      contentType: 'flex',
      body: {
        text: '延伸保固方案',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '延伸保固方案', weight: 'bold', size: 'lg', color: '#1DB446' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '{{contact.name}} 您好', size: 'sm' },
                { type: 'text', text: '您的 {{attribute.model}} 保固即將到期', size: 'sm' },
                { type: 'text', text: '方案：{{attribute.planName}}', size: 'sm', color: '#555555' },
                { type: 'text', text: '費用：NT$ {{attribute.planPrice}}', size: 'sm', color: '#1DB446', weight: 'bold' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.model', label: '產品型號', required: false, defaultValue: '您的產品' },
        { key: 'attribute.planName', label: '方案名稱', required: true },
        { key: 'attribute.planPrice', label: '費用', required: true },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000015',
      name: '會員積點通知',
      description: '通知客戶目前積點和到期資訊',
      category: '行銷類',
      contentType: 'flex',
      body: {
        text: '會員積點通知',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '會員積點通知', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '{{contact.name}} 您好', size: 'sm' },
                { type: 'text', text: '目前積點：{{attribute.points}} 點', size: 'lg', weight: 'bold', color: '#1DB446' },
                { type: 'text', text: '到期日：{{attribute.expiryDate}}', size: 'xs', color: '#888888' },
                { type: 'text', text: '趕快使用您的積點兌換好禮吧！', size: 'sm', margin: 'md' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.points', label: '積點數量', required: true },
        { key: 'attribute.expiryDate', label: '到期日', required: false, defaultValue: '請查看帳戶' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000016',
      name: '促銷活動倒數',
      description: '促銷活動倒數計時提醒',
      category: '行銷類',
      contentType: 'flex',
      body: {
        text: '促銷倒數：{{attribute.promoTitle}}',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '倒數計時', weight: 'bold', size: 'xl', color: '#FF0000' },
              { type: 'text', text: '{{attribute.promoTitle}}', size: 'lg', weight: 'bold', margin: 'md' },
              { type: 'text', text: '剩餘 {{attribute.daysLeft}} 天', size: 'xl', weight: 'bold', color: '#FF6B6B', margin: 'md' },
              { type: 'text', text: '把握最後機會，立即搶購！', size: 'sm', color: '#555555', margin: 'sm' },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.promoTitle', label: '活動標題', required: true },
        { key: 'attribute.daysLeft', label: '剩餘天數', required: true },
      ],
    },
    // ── 23–25: 產品資訊類 Flex ──────────────────────────────────────────────
    {
      id: 'da000000-0000-0000-0000-000000000017',
      name: '產品比較卡',
      description: '兩項產品的規格比較',
      category: '產品資訊類',
      contentType: 'flex',
      body: {
        text: '產品比較',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '產品比較', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                { type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '{{attribute.product1}}', weight: 'bold', size: 'sm' },
                  { type: 'text', text: '{{attribute.spec1}}', size: 'xs', color: '#555555', wrap: true },
                  { type: 'text', text: 'NT$ {{attribute.price1}}', size: 'sm', color: '#1DB446', weight: 'bold' },
                ] },
                { type: 'separator', margin: 'md' },
                { type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '{{attribute.product2}}', weight: 'bold', size: 'sm' },
                  { type: 'text', text: '{{attribute.spec2}}', size: 'xs', color: '#555555', wrap: true },
                  { type: 'text', text: 'NT$ {{attribute.price2}}', size: 'sm', color: '#1DB446', weight: 'bold' },
                ] },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.product1', label: '產品1名稱', required: true },
        { key: 'attribute.spec1', label: '產品1規格', required: false, defaultValue: '-' },
        { key: 'attribute.price1', label: '產品1售價', required: true },
        { key: 'attribute.product2', label: '產品2名稱', required: true },
        { key: 'attribute.spec2', label: '產品2規格', required: false, defaultValue: '-' },
        { key: 'attribute.price2', label: '產品2售價', required: true },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000018',
      name: '常用功能說明',
      description: '產品常用功能圖文說明',
      category: '產品資訊類',
      contentType: 'flex',
      body: {
        text: '常用功能說明',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '{{attribute.model}} 常用功能', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'md', contents: [
                { type: 'text', text: '1. {{attribute.feature1}}', size: 'sm', wrap: true },
                { type: 'text', text: '2. {{attribute.feature2}}', size: 'sm', wrap: true },
                { type: 'text', text: '3. {{attribute.feature3}}', size: 'sm', wrap: true },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.model', label: '產品型號', required: true },
        { key: 'attribute.feature1', label: '功能1', required: true },
        { key: 'attribute.feature2', label: '功能2', required: false, defaultValue: '-' },
        { key: 'attribute.feature3', label: '功能3', required: false, defaultValue: '-' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000019',
      name: 'QR Code 說明書連結',
      description: '提供產品說明書 QR Code 連結',
      category: '產品資訊類',
      contentType: 'flex',
      body: {
        text: '產品說明書連結',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '產品說明書', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '型號：{{attribute.model}}', size: 'sm' },
                { type: 'text', text: '請掃描 QR Code 或點擊下方連結查看完整說明書', size: 'sm', color: '#555555', wrap: true },
                { type: 'text', text: '{{attribute.manualUrl}}', size: 'xs', color: '#1DB446', margin: 'md', wrap: true },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.model', label: '產品型號', required: true },
        { key: 'attribute.manualUrl', label: '說明書連結', required: true },
      ],
    },
    // ── 26–30: 互動類 ──────────────────────────────────────────────────────
    {
      id: 'da000000-0000-0000-0000-00000000001a',
      name: '問卷調查（單選）',
      description: '單選問卷調查卡片',
      category: '互動類',
      contentType: 'flex',
      body: {
        text: '問卷調查',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '問卷調查', weight: 'bold', size: 'lg' },
              { type: 'text', text: '{{attribute.question}}', size: 'sm', margin: 'md', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm', contents: [
              { type: 'button', action: { type: 'postback', label: '{{attribute.option1}}', data: 'survey=1' }, style: 'primary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '{{attribute.option2}}', data: 'survey=2' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '{{attribute.option3}}', data: 'survey=3' }, style: 'secondary', height: 'sm' },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.question', label: '問題', required: true },
        { key: 'attribute.option1', label: '選項1', required: true },
        { key: 'attribute.option2', label: '選項2', required: true },
        { key: 'attribute.option3', label: '選項3', required: false, defaultValue: '其他' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000001b',
      name: '問卷調查（多選）',
      description: '多選問卷調查卡片',
      category: '互動類',
      contentType: 'flex',
      body: {
        text: '多選問卷',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '多選問卷', weight: 'bold', size: 'lg' },
              { type: 'text', text: '{{attribute.question}}', size: 'sm', margin: 'md', wrap: true },
              { type: 'text', text: '（可複選，請依序回覆選項編號）', size: 'xs', color: '#888888', margin: 'sm' },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm', contents: [
              { type: 'button', action: { type: 'postback', label: '1. {{attribute.option1}}', data: 'multi=1' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '2. {{attribute.option2}}', data: 'multi=2' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '3. {{attribute.option3}}', data: 'multi=3' }, style: 'secondary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '4. {{attribute.option4}}', data: 'multi=4' }, style: 'secondary', height: 'sm' },
            ],
          },
        },
      },
      variables: [
        { key: 'attribute.question', label: '問題', required: true },
        { key: 'attribute.option1', label: '選項1', required: true },
        { key: 'attribute.option2', label: '選項2', required: true },
        { key: 'attribute.option3', label: '選項3', required: false, defaultValue: '選項3' },
        { key: 'attribute.option4', label: '選項4', required: false, defaultValue: '其他' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000001c',
      name: '搜尋結果卡（輪播）',
      description: '多筆搜尋結果的輪播卡片',
      category: '互動類',
      contentType: 'flex',
      body: {
        text: '搜尋結果',
        flexJson: {
          type: 'carousel',
          contents: [
            {
              type: 'bubble',
              body: {
                type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: '{{attribute.result1Title}}', weight: 'bold', size: 'md' },
                  { type: 'text', text: '{{attribute.result1Desc}}', size: 'sm', color: '#555555', wrap: true, margin: 'sm' },
                ],
              },
            },
            {
              type: 'bubble',
              body: {
                type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: '{{attribute.result2Title}}', weight: 'bold', size: 'md' },
                  { type: 'text', text: '{{attribute.result2Desc}}', size: 'sm', color: '#555555', wrap: true, margin: 'sm' },
                ],
              },
            },
            {
              type: 'bubble',
              body: {
                type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: '{{attribute.result3Title}}', weight: 'bold', size: 'md' },
                  { type: 'text', text: '{{attribute.result3Desc}}', size: 'sm', color: '#555555', wrap: true, margin: 'sm' },
                ],
              },
            },
          ],
        },
      },
      variables: [
        { key: 'attribute.result1Title', label: '結果1標題', required: true },
        { key: 'attribute.result1Desc', label: '結果1描述', required: false, defaultValue: '-' },
        { key: 'attribute.result2Title', label: '結果2標題', required: false, defaultValue: '-' },
        { key: 'attribute.result2Desc', label: '結果2描述', required: false, defaultValue: '-' },
        { key: 'attribute.result3Title', label: '結果3標題', required: false, defaultValue: '-' },
        { key: 'attribute.result3Desc', label: '結果3描述', required: false, defaultValue: '-' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000001d',
      name: '個人儀表板',
      description: '顯示客戶個人化資訊',
      category: '互動類',
      contentType: 'flex',
      body: {
        text: '個人儀表板',
        flexJson: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '{{contact.name}} 的儀表板', weight: 'bold', size: 'lg' },
              { type: 'separator', margin: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                { type: 'text', text: '案件數：{{attribute.caseCount}}', size: 'sm' },
                { type: 'text', text: '未結案件：{{attribute.openCases}}', size: 'sm', color: '#FF6B6B' },
                { type: 'text', text: '會員積點：{{attribute.points}}', size: 'sm', color: '#1DB446' },
                { type: 'text', text: '上次互動：{{attribute.lastInteraction}}', size: 'xs', color: '#888888', margin: 'md' },
              ] },
            ],
          },
        },
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
        { key: 'attribute.caseCount', label: '案件數', required: false, defaultValue: '0' },
        { key: 'attribute.openCases', label: '未結案件', required: false, defaultValue: '0' },
        { key: 'attribute.points', label: '積點', required: false, defaultValue: '0' },
        { key: 'attribute.lastInteraction', label: '上次互動', required: false, defaultValue: '-' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-00000000001e',
      name: '圖文選單替代卡',
      description: '以快速回覆模擬圖文選單功能',
      category: '互動類',
      contentType: 'quick_reply',
      body: {
        text: '{{contact.name}} 您好！請選擇您需要的服務：',
        quickReplies: [
          { label: '查詢訂單', text: '我要查詢訂單', postbackData: 'action=order_query' },
          { label: '報修服務', text: '我需要報修', postbackData: 'action=repair' },
          { label: '產品諮詢', text: '我想了解產品', postbackData: 'action=product' },
          { label: '聯繫客服', text: '轉接真人客服', postbackData: 'action=handoff' },
        ],
      },
      variables: [
        { key: 'contact.name', label: '客戶名稱', required: false, defaultValue: '您' },
      ],
    },
    // ── 31–32: FB 模板 ─────────────────────────────────────────────────────
    {
      id: 'da000000-0000-0000-0000-00000000001f',
      name: 'FB 通用卡片',
      description: 'Facebook 通用卡片模板（單卡）',
      category: 'FB模板',
      contentType: 'fb_generic',
      body: {
        text: '{{attribute.title}}',
        fbElements: [
          {
            title: '{{attribute.title}}',
            subtitle: '{{attribute.subtitle}}',
            imageUrl: '{{attribute.imageUrl}}',
            buttons: [
              { type: 'web_url', title: '查看詳情', url: '{{attribute.detailUrl}}' },
              { type: 'postback', title: '聯繫客服', payload: 'CONTACT_AGENT' },
            ],
          },
        ],
      },
      variables: [
        { key: 'attribute.title', label: '標題', required: true },
        { key: 'attribute.subtitle', label: '副標題', required: false, defaultValue: '' },
        { key: 'attribute.imageUrl', label: '圖片網址', required: false, defaultValue: 'https://placehold.co/600x400' },
        { key: 'attribute.detailUrl', label: '詳情連結', required: false, defaultValue: '#' },
      ],
    },
    {
      id: 'da000000-0000-0000-0000-000000000020',
      name: 'FB 輪播卡',
      description: 'Facebook 輪播卡模板（多卡）',
      category: 'FB模板',
      contentType: 'fb_carousel',
      body: {
        text: '精選推薦',
        fbElements: [
          {
            title: '{{attribute.card1Title}}',
            subtitle: '{{attribute.card1Desc}}',
            imageUrl: '{{attribute.card1Image}}',
            buttons: [
              { type: 'web_url', title: '了解更多', url: '{{attribute.card1Url}}' },
            ],
          },
          {
            title: '{{attribute.card2Title}}',
            subtitle: '{{attribute.card2Desc}}',
            imageUrl: '{{attribute.card2Image}}',
            buttons: [
              { type: 'web_url', title: '了解更多', url: '{{attribute.card2Url}}' },
            ],
          },
          {
            title: '{{attribute.card3Title}}',
            subtitle: '{{attribute.card3Desc}}',
            imageUrl: '{{attribute.card3Image}}',
            buttons: [
              { type: 'web_url', title: '了解更多', url: '{{attribute.card3Url}}' },
            ],
          },
        ],
      },
      variables: [
        { key: 'attribute.card1Title', label: '卡片1標題', required: true },
        { key: 'attribute.card1Desc', label: '卡片1描述', required: false, defaultValue: '' },
        { key: 'attribute.card1Image', label: '卡片1圖片', required: false, defaultValue: 'https://placehold.co/600x400' },
        { key: 'attribute.card1Url', label: '卡片1連結', required: false, defaultValue: '#' },
        { key: 'attribute.card2Title', label: '卡片2標題', required: false, defaultValue: '產品2' },
        { key: 'attribute.card2Desc', label: '卡片2描述', required: false, defaultValue: '' },
        { key: 'attribute.card2Image', label: '卡片2圖片', required: false, defaultValue: 'https://placehold.co/600x400' },
        { key: 'attribute.card2Url', label: '卡片2連結', required: false, defaultValue: '#' },
        { key: 'attribute.card3Title', label: '卡片3標題', required: false, defaultValue: '產品3' },
        { key: 'attribute.card3Desc', label: '卡片3描述', required: false, defaultValue: '' },
        { key: 'attribute.card3Image', label: '卡片3圖片', required: false, defaultValue: 'https://placehold.co/600x400' },
        { key: 'attribute.card3Url', label: '卡片3連結', required: false, defaultValue: '#' },
      ],
    },
  ];

  for (const tpl of systemTemplates) {
    // Derive channel type from contentType/category
    let channelType = 'universal';
    if (tpl.contentType === 'fb_generic' || tpl.contentType === 'fb_carousel') {
      channelType = 'FB';
    } else if (tpl.contentType === 'flex') {
      channelType = 'LINE';
    }

    await prisma.messageTemplate.upsert({
      where: { id: tpl.id },
      update: {
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        contentType: tpl.contentType,
        body: tpl.body,
        variables: tpl.variables,
        isSystem: true,
        isActive: true,
      },
      create: {
        id: tpl.id,
        tenantId: null,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        channelType,
        contentType: tpl.contentType,
        body: tpl.body,
        variables: tpl.variables,
        isSystem: true,
        isActive: true,
      },
    });
  }
  console.log('  [OK] Message Templates (32)');

  // ── Portal Activities ──────────────────────────────────────────────────────

  const POLL_ID = 'db000000-0000-0000-0000-000000000001';
  const FORM_ID = 'db000000-0000-0000-0000-000000000002';
  const QUIZ_ID = 'db000000-0000-0000-0000-000000000003';

  // POLL: "最喜歡的產品系列" (PUBLISHED)
  await prisma.portalActivity.upsert({
    where: { id: POLL_ID },
    update: {
      title: '最喜歡的產品系列',
      type: 'POLL',
      status: 'PUBLISHED',
      description: '投票選出你最喜歡的產品系列，參與即可獲得 10 點積分！',
      settings: { pointsPerSubmit: 10, showResults: true },
      publishedAt: daysAgo(7),
      startsAt: daysAgo(7),
      endsAt: hoursFromNow(24 * 14),
    },
    create: {
      id: POLL_ID,
      tenantId: TENANT_ID,
      createdById: ADMIN_ID,
      title: '最喜歡的產品系列',
      type: 'POLL',
      status: 'PUBLISHED',
      description: '投票選出你最喜歡的產品系列，參與即可獲得 10 點積分！',
      settings: { pointsPerSubmit: 10, showResults: true },
      publishedAt: daysAgo(7),
      startsAt: daysAgo(7),
      endsAt: hoursFromNow(24 * 14),
    },
  });

  // POLL options
  const pollOptions = [
    { id: 'db0a0000-0000-0000-0000-000000000001', label: '經典系列', sortOrder: 0 },
    { id: 'db0a0000-0000-0000-0000-000000000002', label: '創新系列', sortOrder: 1 },
    { id: 'db0a0000-0000-0000-0000-000000000003', label: '環保系列', sortOrder: 2 },
    { id: 'db0a0000-0000-0000-0000-000000000004', label: '聯名系列', sortOrder: 3 },
  ];
  for (const opt of pollOptions) {
    await prisma.portalOption.upsert({
      where: { id: opt.id },
      update: { label: opt.label, sortOrder: opt.sortOrder },
      create: { id: opt.id, activityId: POLL_ID, label: opt.label, sortOrder: opt.sortOrder },
    });
  }

  // FORM: "線下活動報名" (PUBLISHED)
  await prisma.portalActivity.upsert({
    where: { id: FORM_ID },
    update: {
      title: '線下活動報名',
      type: 'FORM',
      status: 'PUBLISHED',
      description: '報名參加我們的線下粉絲見面會',
      settings: { pointsPerSubmit: 5 },
      publishedAt: daysAgo(3),
      startsAt: daysAgo(3),
      endsAt: hoursFromNow(24 * 7),
    },
    create: {
      id: FORM_ID,
      tenantId: TENANT_ID,
      createdById: ADMIN_ID,
      title: '線下活動報名',
      type: 'FORM',
      status: 'PUBLISHED',
      description: '報名參加我們的線下粉絲見面會',
      settings: { pointsPerSubmit: 5 },
      publishedAt: daysAgo(3),
      startsAt: daysAgo(3),
      endsAt: hoursFromNow(24 * 7),
    },
  });

  // FORM fields
  const formFields = [
    { id: 'db0b0000-0000-0000-0000-000000000001', fieldKey: 'name', label: '姓名', fieldType: 'text', isRequired: true, sortOrder: 0 },
    { id: 'db0b0000-0000-0000-0000-000000000002', fieldKey: 'phone', label: '電話', fieldType: 'phone', isRequired: true, sortOrder: 1 },
    { id: 'db0b0000-0000-0000-0000-000000000003', fieldKey: 'note', label: '備註', fieldType: 'textarea', isRequired: false, sortOrder: 2 },
  ];
  for (const f of formFields) {
    await prisma.portalField.upsert({
      where: { id: f.id },
      update: { fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired, sortOrder: f.sortOrder },
      create: { id: f.id, activityId: FORM_ID, fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired, sortOrder: f.sortOrder, options: [] },
    });
  }

  // QUIZ: "品牌知識挑戰" (DRAFT)
  await prisma.portalActivity.upsert({
    where: { id: QUIZ_ID },
    update: {
      title: '品牌知識挑戰',
      type: 'QUIZ',
      status: 'DRAFT',
      description: '測試你對品牌的了解程度！答對越多分數越高',
      settings: { pointsPerSubmit: 20 },
    },
    create: {
      id: QUIZ_ID,
      tenantId: TENANT_ID,
      createdById: ADMIN_ID,
      title: '品牌知識挑戰',
      type: 'QUIZ',
      status: 'DRAFT',
      description: '測試你對品牌的了解程度！答對越多分數越高',
      settings: { pointsPerSubmit: 20 },
    },
  });

  // QUIZ options (1 correct)
  const quizOptions = [
    { id: 'db0a0000-0000-0000-0000-000000000005', label: '2015 年', sortOrder: 0, isCorrect: false },
    { id: 'db0a0000-0000-0000-0000-000000000006', label: '2018 年', sortOrder: 1, isCorrect: true },
    { id: 'db0a0000-0000-0000-0000-000000000007', label: '2020 年', sortOrder: 2, isCorrect: false },
  ];
  for (const opt of quizOptions) {
    await prisma.portalOption.upsert({
      where: { id: opt.id },
      update: { label: opt.label, sortOrder: opt.sortOrder, isCorrect: opt.isCorrect },
      create: { id: opt.id, activityId: QUIZ_ID, label: opt.label, sortOrder: opt.sortOrder, isCorrect: opt.isCorrect },
    });
  }

  // POLL submissions (CONTACT1, CONTACT2, CONTACT4)
  const pollSubs = [
    { id: 'db0c0000-0000-0000-0000-000000000001', contactId: CONTACT1_ID, answers: { optionIds: ['db0a0000-0000-0000-0000-000000000001'] }, createdAt: daysAgo(5) },
    { id: 'db0c0000-0000-0000-0000-000000000002', contactId: CONTACT2_ID, answers: { optionIds: ['db0a0000-0000-0000-0000-000000000003'] }, createdAt: daysAgo(4) },
    { id: 'db0c0000-0000-0000-0000-000000000003', contactId: CONTACT4_ID, answers: { optionIds: ['db0a0000-0000-0000-0000-000000000002'] }, createdAt: daysAgo(3) },
  ];
  for (const sub of pollSubs) {
    await prisma.portalSubmission.upsert({
      where: { id: sub.id },
      update: { answers: sub.answers },
      create: {
        id: sub.id, activityId: POLL_ID, contactId: sub.contactId, tenantId: TENANT_ID,
        answers: sub.answers, pointsEarned: 10, createdAt: sub.createdAt,
      },
    });
  }

  // FORM submissions (CONTACT1, CONTACT3)
  const formSubs = [
    { id: 'db0c0000-0000-0000-0000-000000000004', contactId: CONTACT1_ID, answers: { fields: { name: '王小美', phone: '0912345678', note: '期待見面會' } }, createdAt: daysAgo(2) },
    { id: 'db0c0000-0000-0000-0000-000000000005', contactId: CONTACT3_ID, answers: { fields: { name: '陳小芳', phone: '0945678901', note: '' } }, createdAt: daysAgo(1) },
  ];
  for (const sub of formSubs) {
    await prisma.portalSubmission.upsert({
      where: { id: sub.id },
      update: { answers: sub.answers },
      create: {
        id: sub.id, activityId: FORM_ID, contactId: sub.contactId, tenantId: TENANT_ID,
        answers: sub.answers, pointsEarned: 5, createdAt: sub.createdAt,
      },
    });
  }

  // Point Transactions for submitters
  const pointTxs = [
    { id: 'dc000000-0000-0000-0000-000000000001', contactId: CONTACT1_ID, amount: 10, balance: 10, type: 'activity_submit', refId: 'db0c0000-0000-0000-0000-000000000001', note: '參加活動「最喜歡的產品系列」', createdAt: daysAgo(5) },
    { id: 'dc000000-0000-0000-0000-000000000002', contactId: CONTACT2_ID, amount: 10, balance: 10, type: 'activity_submit', refId: 'db0c0000-0000-0000-0000-000000000002', note: '參加活動「最喜歡的產品系列」', createdAt: daysAgo(4) },
    { id: 'dc000000-0000-0000-0000-000000000003', contactId: CONTACT4_ID, amount: 10, balance: 10, type: 'activity_submit', refId: 'db0c0000-0000-0000-0000-000000000003', note: '參加活動「最喜歡的產品系列」', createdAt: daysAgo(3) },
    { id: 'dc000000-0000-0000-0000-000000000004', contactId: CONTACT1_ID, amount: 5, balance: 15, type: 'activity_submit', refId: 'db0c0000-0000-0000-0000-000000000004', note: '參加活動「線下活動報名」', createdAt: daysAgo(2) },
    { id: 'dc000000-0000-0000-0000-000000000005', contactId: CONTACT3_ID, amount: 5, balance: 5, type: 'activity_submit', refId: 'db0c0000-0000-0000-0000-000000000005', note: '參加活動「線下活動報名」', createdAt: daysAgo(1) },
  ];
  for (const tx of pointTxs) {
    await prisma.pointTransaction.upsert({
      where: { id: tx.id },
      update: { amount: tx.amount, balance: tx.balance },
      create: {
        id: tx.id, tenantId: TENANT_ID, contactId: tx.contactId,
        amount: tx.amount, balance: tx.balance, type: tx.type,
        refId: tx.refId, note: tx.note, createdAt: tx.createdAt,
      },
    });
  }
  console.log('  [OK] Portal Activities (3), Submissions (5), Points (5)');

  // ── Short Links ───────────────────────────────────────────────────────────

  const LINK1_ID = 'de000000-0000-0000-0000-000000000001';
  const LINK2_ID = 'de000000-0000-0000-0000-000000000002';
  const LINK3_ID = 'de000000-0000-0000-0000-000000000003';

  // LINK1: active with UTM + tagOnClick
  await prisma.shortLink.upsert({
    where: { id: LINK1_ID },
    update: {
      targetUrl: 'https://example.com/promo',
      title: '春季促銷活動',
      utmSource: 'line', utmMedium: 'social', utmCampaign: 'spring2024',
      tagOnClick: TAG2_ID, isActive: true,
    },
    create: {
      id: LINK1_ID, tenantId: TENANT_ID, createdById: ADMIN_ID,
      slug: 'promo1', targetUrl: 'https://example.com/promo',
      title: '春季促銷活動',
      utmSource: 'line', utmMedium: 'social', utmCampaign: 'spring2024',
      tagOnClick: TAG2_ID, isActive: true,
      totalClicks: 0, uniqueClicks: 0,
    },
  });

  // LINK2: active with click logs
  await prisma.shortLink.upsert({
    where: { id: LINK2_ID },
    update: {
      targetUrl: 'https://example.com/event',
      title: '粉絲見面會報名',
      isActive: true, totalClicks: 15, uniqueClicks: 10,
    },
    create: {
      id: LINK2_ID, tenantId: TENANT_ID, createdById: ADMIN_ID,
      slug: 'event1', targetUrl: 'https://example.com/event',
      title: '粉絲見面會報名',
      isActive: true, totalClicks: 15, uniqueClicks: 10,
    },
  });

  // LINK3: expired
  await prisma.shortLink.upsert({
    where: { id: LINK3_ID },
    update: {
      targetUrl: 'https://example.com/old',
      title: '已過期活動',
      isActive: true, expiresAt: daysAgo(30),
    },
    create: {
      id: LINK3_ID, tenantId: TENANT_ID, createdById: ADMIN_ID,
      slug: 'old1', targetUrl: 'https://example.com/old',
      title: '已過期活動',
      isActive: true, expiresAt: daysAgo(30),
      totalClicks: 3, uniqueClicks: 2,
    },
  });

  // Click logs for LINK2 — 15 logs over 7 days (5 identified by contact)
  const clickLogIds = Array.from({ length: 15 }, (_, i) =>
    `df000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
  );
  const contacts = [CONTACT1_ID, CONTACT2_ID, CONTACT3_ID, CONTACT4_ID, CONTACT5_ID];
  for (let i = 0; i < 15; i++) {
    const daysOffset = Math.floor(i / 3) + 1; // spread over ~5 days
    await prisma.clickLog.upsert({
      where: { id: clickLogIds[i] },
      update: {},
      create: {
        id: clickLogIds[i],
        shortLinkId: LINK2_ID,
        contactId: i < 5 ? contacts[i] : null, // first 5 identified
        ip: `192.168.1.${100 + i}`,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)',
        referer: i % 3 === 0 ? 'https://line.me' : i % 3 === 1 ? 'https://facebook.com' : null,
        createdAt: daysAgo(daysOffset),
      },
    });
  }
  console.log('  [OK] Short Links (3), Click Logs (15)');

  // ── KB Articles ─────────────────────────────────────────────────────────────
  const kbArticles = [
    {
      id: KB1_ID,
      title: '產品保固政策說明',
      category: '保固',
      tags: ['保固', '政策', '售後'],
      summary: 'Open333 家電產品保固政策總覽，包含一般保固及延長保固說明。',
      content: `# Open333 產品保固政策

## 標準保固期限
- **一般家電產品**（電視、微波爐、電鍋等）：自購買日起 **1 年**
- **冰箱壓縮機**：自購買日起 **3 年**
- **洗衣機馬達**：自購買日起 **5 年**
- **冷氣壓縮機**：自購買日起 **3 年**

## 保固範圍
1. 產品在正常使用下發生的故障
2. 原廠零件的材料或製造瑕疵
3. 保固期內免費到府維修服務（含零件及工資）

## 不在保固範圍
- 人為損壞、不當使用
- 自行拆裝或非原廠維修造成的損壞
- 天災（如雷擊、水災）造成的損壞
- 消耗品（如濾網、燈泡）

## 延長保固
可加購延長保固方案，最長延至 5 年。詳情請洽客服人員。`,
    },
    {
      id: KB2_ID,
      title: '維修服務流程',
      category: '維修',
      tags: ['維修', '報修', '流程'],
      summary: '客戶報修到維修完成的完整流程說明。',
      content: `# 維修服務流程

## 報修方式
1. **LINE 官方帳號**：直接傳訊息描述問題
2. **客服電話**：0800-333-333（週一至週五 9:00-18:00）
3. **網站客服**：透過網站右下角客服對話窗

## 維修流程
1. **報修登記**：客服人員確認產品資訊、故障描述，建立服務單
2. **技師派工**：根據地區與產品類型，指派專業技師
3. **預約到府**：技師主動致電客戶，安排到府維修時間
4. **到府維修**：技師攜帶工具與零件到府檢修
5. **維修回報**：維修完成後回報系統，客戶可查詢維修結果

## 維修時效
- **一般件**：報修後 **3 個工作天** 內到府
- **急件**：報修後 **24 小時** 內到府（保固內免加價）
- **偏遠地區**：可能需額外 1-2 個工作天

## 維修費用
- 保固期內：**免費**（含零件及工資）
- 保固期外：依實際零件及工資計費，維修前會先報價確認`,
    },
    {
      id: KB3_ID,
      title: '退換貨規定',
      category: '售後',
      tags: ['退貨', '換貨', '退款', '售後'],
      summary: '產品退換貨政策與流程。',
      content: `# 退換貨規定

## 7 天鑑賞期（線上購買適用）
- 自收到商品日起 **7 天內**，可申請無條件退貨
- 商品須保持全新未使用狀態
- 原廠包裝、配件、贈品須齊全
- 退貨運費由公司負擔

## 瑕疵品換新
- 收到商品即發現瑕疵，可 **免費換新**
- 請在收貨後 **3 天內** 聯繫客服
- 需提供瑕疵照片或影片佐證
- 換新品於 **5 個工作天** 內寄出

## 退款方式
- 信用卡付款：退回原信用卡，約 **7-14 個工作天**
- 銀行轉帳：退回指定帳戶，約 **5 個工作天**
- 貨到付款：退回指定帳戶，約 **5 個工作天**

## 不接受退換貨
- 超過 7 天鑑賞期
- 商品已安裝使用（非瑕疵）
- 客製化商品
- 消耗品（如濾網、濾芯）已拆封`,
    },
    {
      id: KB4_ID,
      title: '冰箱常見問題排除',
      category: '產品FAQ',
      tags: ['冰箱', 'FAQ', '故障排除'],
      summary: '冰箱常見問題自行檢查步驟。',
      content: `# 冰箱常見問題排除

## 冰箱不製冷
1. 檢查電源插頭是否鬆脫
2. 確認溫度設定是否正確（建議冷藏 3-5°C，冷凍 -18°C）
3. 檢查門封條是否密合（可用紙張測試）
4. 清潔冷凝器散熱網（冰箱背面或底部）
5. 確認食物沒有擋住出風口
6. 若以上皆正常，可能是壓縮機或冷媒問題，請聯繫客服報修

## 冰箱結霜嚴重
1. 避免頻繁開關門
2. 食物放涼後再放入冰箱
3. 檢查門封條是否老化
4. 定期除霜（手動除霜機型）
5. 確認排水孔暢通

## 冰箱有異音
1. 壓縮機運轉聲：正常現象
2. 流水聲：冷媒循環聲，屬正常
3. 喀喀聲：溫度變化造成的熱脹冷縮，屬正常
4. 持續嗡嗡聲：檢查冰箱是否水平放置
5. 異常撞擊聲：可能是壓縮機異常，請聯繫客服`,
    },
    {
      id: KB5_ID,
      title: '洗衣機常見問題排除',
      category: '產品FAQ',
      tags: ['洗衣機', 'FAQ', '故障排除'],
      summary: '洗衣機常見問題與錯誤碼處理。',
      content: `# 洗衣機常見問題排除

## 洗衣機不排水
1. 檢查排水管是否彎折或堵塞
2. 清潔排水濾網（通常在機體正面下方）
3. 確認排水管高度不超過 100 公分
4. 檢查排水管是否正確接入排水口
5. 若仍無法排水，可能是排水馬達故障，請聯繫客服

## 洗衣機有異響
1. 確認衣物分佈均勻，避免單邊過重
2. 檢查是否有硬物（如硬幣）卡在滾筒
3. 確認洗衣機放置水平
4. 運輸螺栓是否已移除（新機安裝時）
5. 持續異響請聯繫客服檢修

## 常見錯誤碼
- **E1**：進水異常 → 檢查水龍頭是否開啟、進水管是否折到
- **E2**：排水異常 → 檢查排水管是否堵塞
- **E3**：門蓋未關好 → 重新關閉門蓋
- **E4**：衣物不平衡 → 重新分配衣物後再啟動
- **E5**：水溫異常 → 檢查熱水器設定

## 日常保養建議
- 每月清潔一次洗衣槽（可用專用清潔劑）
- 洗完衣物後打開門蓋通風
- 定期清潔濾網
- 避免超量放入衣物`,
    },
    {
      id: KB6_ID,
      title: '線上購物流程說明',
      category: '購物',
      tags: ['購物', '下單', '付款', '配送'],
      summary: '從選購到安裝的完整線上購物流程。',
      content: `# 線上購物流程說明

## 購物步驟
1. **選購商品**：瀏覽官網商品頁面，選擇規格與數量
2. **加入購物車**：確認商品資訊後加入購物車
3. **結帳下單**：填寫收件資訊，選擇配送方式
4. **線上付款**：支援信用卡、ATM 轉帳、貨到付款
5. **訂單確認**：系統寄送訂單確認信至您的信箱
6. **商品配送**：物流配送到府，可追蹤配送進度
7. **安裝服務**：大型家電提供免費安裝服務

## 配送說明
- **一般商品**：下單後 **3-5 個工作天** 送達
- **大型家電**：下單後 **5-7 個工作天** 配送安裝
- **偏遠地區**：可能需額外 2-3 個工作天
- **免運門檻**：單筆消費滿 **NT$ 1,000** 免運費

## 安裝服務
- 冰箱、洗衣機、冷氣等大型家電提供 **免費基本安裝**
- 安裝師傅會與您約定安裝時間
- 舊機回收服務：**免費** 回收舊家電`,
    },
    {
      id: KB7_ID,
      title: '會員積分規則',
      category: '會員',
      tags: ['會員', '積分', '點數', '兌換'],
      summary: '會員積分累積與兌換規則說明。',
      content: `# 會員積分規則

## 積分累積
- 消費 **1 元 = 1 點**
- 線上購物與門市消費皆可累積
- 參加官方活動可額外獲得積分
- 填寫問卷、投票等互動也可獲得積分

## 積分兌換
- **500 點**：可折抵 NT$ 50 消費金
- **1,000 點**：可兌換精選小家電配件
- **3,000 點**：可兌換延長保固 1 年
- **5,000 點**：可折抵 NT$ 600 消費金（加碼回饋）

## 積分有效期
- 積分自獲得日起 **2 年** 內有效
- 過期積分將自動失效，不另行通知
- 建議定期查看積分餘額與到期日

## VIP 會員
- 年度消費累計達 **NT$ 50,000** 自動升級 VIP
- VIP 享有 **1.5 倍** 積分加成
- VIP 專屬客服優先服務
- VIP 生日當月 **雙倍** 積分`,
    },
    {
      id: KB8_ID,
      title: '節能補助申請指南',
      category: '優惠',
      tags: ['節能', '補助', '政府', '優惠'],
      summary: '政府節能家電補助申請流程說明。',
      content: `# 節能補助申請指南

## 適用產品
- **冰箱**：能效等級 1 級或 2 級
- **冷氣**：能效等級 1 級或 2 級
- **除濕機**：能效等級 1 級或 2 級

## 補助金額
- 1 級能效：每台最高補助 **NT$ 3,000**
- 2 級能效：每台最高補助 **NT$ 1,000**
- 每戶每年最多申請 **3 台**

## 申請流程
1. 購買符合資格的節能家電
2. 保留購買發票正本
3. 準備舊機回收證明（汰舊換新可加碼 NT$ 2,000）
4. 至政府節能補助網站線上申請
5. 上傳所需文件（發票、身分證、存摺封面）
6. 審核通過後，補助款項匯入指定帳戶

## 注意事項
- 須在購買日起 **60 天內** 完成申請
- Open333 提供購買證明協助
- 門市人員可協助線上申請
- 補助名額有限，建議及早申請`,
    },
  ];

  for (const kb of kbArticles) {
    await prisma.kmArticle.create({
      data: {
        id: kb.id,
        tenantId: TENANT_ID,
        title: kb.title,
        content: kb.content,
        summary: kb.summary,
        category: kb.category,
        tags: kb.tags,
        status: 'PUBLISHED',
        createdById: ADMIN_ID,
      },
    });
  }
  console.log('  [OK] KB Articles (8)');

  // ── Marketing: Segments ───────────────────────────────────────────────────
  const segments = [
    {
      id: SEG1_ID,
      name: 'VIP 客戶',
      description: '標記為 VIP 的重要客戶',
      rules: { conditions: [{ field: 'tag', operator: 'equals', value: 'VIP' }], logic: 'AND' },
    },
    {
      id: SEG2_ID,
      name: '冰箱客戶',
      description: '購買過冰箱產品的客戶',
      rules: { conditions: [{ field: 'tag', operator: 'equals', value: '冰箱客戶' }], logic: 'AND' },
    },
    {
      id: SEG3_ID,
      name: '新用戶(近30天)',
      description: '近 30 天內建立的客戶',
      rules: { conditions: [{ field: 'createdAfter', operator: 'gte', value: '30d' }], logic: 'AND' },
    },
  ];

  for (const seg of segments) {
    await prisma.segment.create({
      data: {
        id: seg.id,
        tenantId: TENANT_ID,
        name: seg.name,
        description: seg.description,
        rules: seg.rules,
        contactCount: 0,
        createdById: ADMIN_ID,
      },
    });
  }
  console.log('  [OK] Segments (3)');

  // ── Marketing: Campaigns ──────────────────────────────────────────────────
  await prisma.campaign.create({
    data: {
      id: CAMP1_ID,
      tenantId: TENANT_ID,
      name: '春季家電節',
      description: '春季促銷活動，全品項最低 7 折起，指定機型加贈延保一年',
      status: 'active',
      startDate: daysAgo(14),
      endDate: hoursFromNow(24 * 30),
      metrics: { totalSent: 120, delivered: 115, replied: 32, casesOpened: 5 },
      createdById: ADMIN_ID,
    },
  });

  await prisma.campaign.create({
    data: {
      id: CAMP2_ID,
      tenantId: TENANT_ID,
      name: '新品上市通知',
      description: '全新智慧家電系列即將上市，搶先通知忠實客戶',
      status: 'draft',
      metrics: {},
      createdById: ADMIN_ID,
    },
  });
  console.log('  [OK] Campaigns (2)');

  // ── Marketing: Broadcasts ─────────────────────────────────────────────────
  // Use the first system template for broadcasts
  const WELCOME_TPL_ID = 'da000000-0000-0000-0000-000000000001';
  const PROMO_TPL_ID = 'da000000-0000-0000-0000-000000000008';

  await prisma.broadcast.create({
    data: {
      id: BCAST1_ID,
      tenantId: TENANT_ID,
      campaignId: CAMP1_ID,
      segmentId: SEG1_ID,
      templateId: PROMO_TPL_ID,
      channelId: LINE_CHANNEL_ID,
      name: 'VIP 專屬優惠通知',
      status: 'completed',
      targetType: 'segment',
      targetConfig: {},
      sentAt: daysAgo(7),
      totalCount: 50,
      successCount: 48,
      failedCount: 2,
      createdById: ADMIN_ID,
    },
  });

  await prisma.broadcast.create({
    data: {
      id: BCAST2_ID,
      tenantId: TENANT_ID,
      campaignId: CAMP1_ID,
      segmentId: null,
      templateId: PROMO_TPL_ID,
      channelId: LINE_CHANNEL_ID,
      name: '全品項促銷提醒',
      status: 'scheduled',
      targetType: 'all',
      targetConfig: {},
      scheduledAt: hoursFromNow(48),
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      createdById: ADMIN_ID,
    },
  });

  await prisma.broadcast.create({
    data: {
      id: BCAST3_ID,
      tenantId: TENANT_ID,
      campaignId: CAMP2_ID,
      segmentId: SEG2_ID,
      templateId: WELCOME_TPL_ID,
      channelId: FB_CHANNEL_ID,
      name: '新品預告',
      status: 'draft',
      targetType: 'segment',
      targetConfig: {},
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      createdById: ADMIN_ID,
    },
  });
  console.log('  [OK] Broadcasts (3)');

  // ── Office Hours (TenantSettings) ─────────────────────────────────────────
  await prisma.tenantSettings.create({
    data: {
      id: TSETTINGS_ID,
      tenantId: TENANT_ID,
      timezone: 'Asia/Taipei',
      officeHours: {
        schedule: {
          mon: { enabled: true, start: '09:00', end: '18:00' },
          tue: { enabled: true, start: '09:00', end: '18:00' },
          wed: { enabled: true, start: '09:00', end: '18:00' },
          thu: { enabled: true, start: '09:00', end: '18:00' },
          fri: { enabled: true, start: '09:00', end: '18:00' },
          sat: { enabled: true, start: '10:00', end: '14:00' },
          sun: { enabled: false, start: '09:00', end: '18:00' },
        },
        holidays: [],
        autoReplyMessage: '感謝您的來訊！目前非營業時間（週一至週五 9:00-18:00，週六 10:00-14:00），我們將在營業時間盡速回覆您。',
      },
    },
  });
  console.log('  [OK] TenantSettings / Office Hours (1)');

  // ── Done ────────────────────────────────────────────────────────────────────
  console.log('\nSeed completed successfully!');
  console.log('─────────────────────────────────────────');
  console.log('  Tenant:              1');
  console.log('  Agents:              3');
  console.log('  Teams:               1');
  console.log('  Channels:            3 (with botConfig)');
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
  console.log('  Automation Rules:    7');
  console.log('  Message Templates:   32');
  console.log('  KB Articles:         8');
  console.log('  Segments:            3');
  console.log('  Campaigns:           2');
  console.log('  Broadcasts:          3');
  console.log('  Office Hours:        1');
  console.log('  Portal Activities:   3');
  console.log('  Portal Submissions:  5');
  console.log('  Point Transactions:  5');
  console.log('  Short Links:         3');
  console.log('  Click Logs:          15');
  console.log('─────────────────────────────────────────');
  console.log('\n⚠️  KB articles need embedding. After API starts, run:');
  console.log('  curl -X POST http://localhost:3001/api/v1/knowledge/reembed \\');
  console.log('    -H "Authorization: Bearer <admin-token>" \\');
  console.log('    -H "Content-Type: application/json"');
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
