import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
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
  // Find the ChannelIdentity matching this LINE user + channel
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId, uid: lineUid },
    },
  });

  if (!identity) {
    throw new Error(`ChannelIdentity not found for uid=${lineUid}, channelId=${channelId}`);
  }

  await prisma.contact.update({
    where: { id: identity.contactId },
    data: { email },
  });

  return { contactId: identity.contactId, updated: true };
}
