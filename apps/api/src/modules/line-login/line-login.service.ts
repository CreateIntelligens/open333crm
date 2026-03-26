import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';

// In-memory state store with TTL (10 minutes)
const stateStore = new Map<string, { lineUid: string; channelId: string; expiresAt: number }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of stateStore) {
    if (val.expiresAt < now) stateStore.delete(key);
  }
}, 60_000);

/**
 * Generate LINE Login OAuth authorization URL.
 * Stores (state → lineUid + channelId) mapping for later validation.
 */
export function generateAuthUrl(lineUid: string, channelId: string): string {
  const config = getConfig();
  const state = randomBytes(16).toString('hex');

  stateStore.set(state, {
    lineUid,
    channelId,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.LINE_LOGIN_CHANNEL_ID!,
    redirect_uri: config.LINE_LOGIN_CALLBACK_URL!,
    state,
    scope: 'openid email',
    bot_prompt: 'normal',
  });

  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

/**
 * Validate and consume a state parameter. Returns null if invalid/expired.
 */
export function validateState(state: string): { lineUid: string; channelId: string } | null {
  const entry = stateStore.get(state);
  if (!entry) return null;

  stateStore.delete(state); // consume

  if (entry.expiresAt < Date.now()) return null;

  return { lineUid: entry.lineUid, channelId: entry.channelId };
}

/**
 * Exchange authorization code for tokens via LINE Login API.
 */
export async function exchangeCodeForToken(code: string): Promise<{ idToken: string; accessToken: string }> {
  const config = getConfig();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.LINE_LOGIN_CALLBACK_URL!,
    client_id: config.LINE_LOGIN_CHANNEL_ID!,
    client_secret: config.LINE_LOGIN_CHANNEL_SECRET!,
  });

  const res = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`LINE token exchange failed: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as { id_token: string; access_token: string };
  return { idToken: data.id_token, accessToken: data.access_token };
}

/**
 * Verify the ID token and extract email from it.
 */
export async function verifyIdToken(idToken: string): Promise<{ email?: string; userId: string }> {
  const config = getConfig();

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: config.LINE_LOGIN_CHANNEL_ID!,
  });

  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`LINE ID token verification failed: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as { sub: string; email?: string };
  return { userId: data.sub, email: data.email };
}

/**
 * Update the Contact's email by finding them via ChannelIdentity (lineUid + channelId).
 */
export async function updateContactEmail(
  prisma: PrismaClient,
  lineUid: string,
  email: string,
  channelId: string,
): Promise<{ contactId: string; updated: boolean }> {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId, uid: lineUid },
    },
    include: {
      channel: { select: { tenantId: true, channelType: true } },
      contact: { select: { id: true, email: true, avatarUrl: true } },
    },
  });

  if (!identity) {
    throw new Error(`ChannelIdentity not found for uid=${lineUid}, channelId=${channelId}`);
  }

  const contactId = await prisma.$transaction(async (tx) => {
    const existing = await tx.contact.findFirst({
      where: {
        tenantId: identity.channel.tenantId,
        email,
      },
      select: { id: true },
    });

    if (!existing || existing.id === identity.contactId) {
      await tx.contact.update({
        where: { id: identity.contactId },
        data: { email },
      });
      return identity.contactId;
    }

    await mergeContactIntoTarget(tx, identity.contactId, existing.id, email);
    await tx.channelIdentity.update({
      where: { id: identity.id },
      data: { contactId: existing.id },
    });

    return existing.id;
  });

  await upsertIdentityMap(prisma, identity.channel.tenantId, contactId, identity.channel.channelType, lineUid);

  return { contactId, updated: true };
}

async function upsertIdentityMap(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  channelType: string,
  uid: string,
) {
  await prisma.identityMap.upsert({
    where: {
      tenantId_channelType_uid: {
        tenantId,
        channelType: channelType as never,
        uid,
      },
    },
    create: {
      tenantId,
      contactId,
      channelType: channelType as never,
      uid,
      source: 'LIFF_COOKIE',
      confidence: 0.85,
    },
    update: {
      contactId,
      source: 'LIFF_COOKIE',
      mergedAt: new Date(),
    },
  });
}

async function mergeContactIntoTarget(
  tx: Prisma.TransactionClient,
  sourceContactId: string,
  targetContactId: string,
  email: string,
) {
  await tx.conversation.updateMany({
    where: { contactId: sourceContactId },
    data: { contactId: targetContactId },
  });

  await tx.case.updateMany({
    where: { contactId: sourceContactId },
    data: { contactId: targetContactId },
  });

  await tx.longTermMemory.updateMany({
    where: { contactId: sourceContactId },
    data: { contactId: targetContactId },
  });

  await tx.identityMap.updateMany({
    where: { contactId: sourceContactId },
    data: { contactId: targetContactId },
  });

  const tags = await tx.contactTag.findMany({ where: { contactId: sourceContactId } });
  for (const tag of tags) {
    await tx.contactTag.upsert({
      where: { contactId_tagId: { contactId: targetContactId, tagId: tag.tagId } },
      create: {
        contactId: targetContactId,
        tagId: tag.tagId,
        addedBy: tag.addedBy,
        addedById: tag.addedById,
        addedAt: tag.addedAt,
        expiresAt: tag.expiresAt,
      },
      update: {},
    });
  }

  const attributes = await tx.contactAttribute.findMany({ where: { contactId: sourceContactId } });
  for (const attribute of attributes) {
    await tx.contactAttribute.upsert({
      where: { contactId_key: { contactId: targetContactId, key: attribute.key } },
      create: {
        contactId: targetContactId,
        key: attribute.key,
        value: attribute.value,
        dataType: attribute.dataType,
      },
      update: {},
    });
  }

  await tx.contact.update({
    where: { id: targetContactId },
    data: { email },
  });

  await tx.contact.delete({
    where: { id: sourceContactId },
  });
}
