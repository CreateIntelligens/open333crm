import { randomBytes, createHmac } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';

// In-memory state store with TTL (10 minutes)
const stateStore = new Map<string, { psid: string; channelId: string; expiresAt: number }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of stateStore) {
    if (val.expiresAt < now) stateStore.delete(key);
  }
}, 60_000);

const FB_GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Generate Facebook Login OAuth authorization URL.
 * Stores (state → psid + channelId) mapping for later validation.
 */
export function generateAuthUrl(psid: string, channelId: string): string {
  const config = getConfig();
  const state = randomBytes(16).toString('hex');

  stateStore.set(state, {
    psid,
    channelId,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: config.FB_LOGIN_APP_ID!,
    redirect_uri: config.FB_LOGIN_CALLBACK_URL!,
    state,
    scope: 'email',
    response_type: 'code',
    auth_type: 'rerequest',
  });

  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

/**
 * Validate and consume a state parameter. Returns null if invalid/expired.
 */
export function validateState(state: string): { psid: string; channelId: string } | null {
  const entry = stateStore.get(state);
  if (!entry) return null;

  stateStore.delete(state); // consume

  if (entry.expiresAt < Date.now()) return null;

  return { psid: entry.psid, channelId: entry.channelId };
}

/**
 * Exchange authorization code for access token via Facebook Graph API.
 */
export async function exchangeCodeForToken(code: string): Promise<{ accessToken: string }> {
  const config = getConfig();

  const params = new URLSearchParams({
    client_id: config.FB_LOGIN_APP_ID!,
    client_secret: config.FB_LOGIN_APP_SECRET!,
    redirect_uri: config.FB_LOGIN_CALLBACK_URL!,
    code,
  });

  const res = await fetch(`${FB_GRAPH_API}/oauth/access_token?${params.toString()}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Facebook token exchange failed: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as { access_token: string };
  return { accessToken: data.access_token };
}

/**
 * Get user email using the user's access token.
 */
export async function getUserEmail(accessToken: string): Promise<{ email?: string }> {
  const config = getConfig();
  const appsecretProof = createHmac('sha256', config.FB_LOGIN_APP_SECRET!)
    .update(accessToken)
    .digest('hex');

  const res = await fetch(
    `${FB_GRAPH_API}/me?fields=email&access_token=${accessToken}&appsecret_proof=${appsecretProof}`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Facebook get user email failed: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as { email?: string };
  return { email: data.email };
}

/**
 * Update the Contact's email by finding them via ChannelIdentity (psid + channelId).
 */
export async function updateContactEmail(
  prisma: PrismaClient,
  psid: string,
  email: string,
  channelId: string,
): Promise<{ contactId: string; updated: boolean }> {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId, uid: psid },
    },
    include: {
      channel: { select: { tenantId: true, channelType: true } },
      contact: { select: { id: true } },
    },
  });

  if (!identity) {
    throw new Error(`ChannelIdentity not found for uid=${psid}, channelId=${channelId}`);
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

  await upsertIdentityMap(prisma, identity.channel.tenantId, contactId, identity.channel.channelType, psid);

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
