import { randomBytes, createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';
import { mergeContacts } from '../contact/contact-merge.service.js';

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
        isArchived: false,
      },
      select: { id: true },
    });

    if (!existing || existing.id === identity.contactId) {
      await tx.contact.update({
        where: { id: identity.contactId, tenantId: identity.channel.tenantId },
        data: { email },
      });
      return identity.contactId;
    }

    // 已有同 email 的聯絡人 → 併入該聯絡人（統一合併引擎：搬移全部關聯資料、封存不硬刪）
    await mergeContacts(tx, {
      tenantId: identity.channel.tenantId,
      survivorId: existing.id,
      mergedId: identity.contactId,
      source: 'FB_LOGIN',
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
