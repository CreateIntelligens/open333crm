/**
 * Identity Stitcher — Cookie tracking, UID collision, and phone-based auto-merge (Tasks 4.1, 4.2)
 * Handles cross-channel identity linking for LINE UID, FB PSID, Email, and Phone.
 */

import { prisma } from '@open333crm/database';
import { logger } from '../logger/index.js';
import type { ChannelType } from '@prisma/client';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Task 4.1: Stitch a channel UID to a contact via LIFF Cookie (email or phone from browser).
 *
 * Called from LIFF entry point when a user lands on a LIFF page that has a
 * known email/phone in the browser cookie (set by a previous web visit).
 *
 * @param tenantId      - Tenant scope
 * @param channelType   - 'LINE' | 'FB' | etc.
 * @param uid           - Channel UID (LINE userId, FB psid)
 * @param cookieEmail   - Email found in browser cookie
 * @returns Contact ID if stitched, null if no match found
 */
export async function stitchByLiffCookie(
  tenantId: string,
  channelType: ChannelType,
  uid: string,
  cookieEmail: string,
): Promise<string | null> {
  if (!cookieEmail) return null;

  const contact = await prisma.contact.findFirst({
    where: { tenantId, email: cookieEmail },
  });

  if (!contact) {
    logger.debug(`[IdentityStitcher] No contact found for email=${cookieEmail}`);
    return null;
  }

  await upsertIdentityMap(tenantId, contact.id, channelType, uid, 'LIFF_COOKIE');

  logger.info(`[IdentityStitcher] Stitched ${channelType} uid=${uid} to contact=${contact.id} via LIFF cookie`);
  return contact.id;
}

/**
 * Task 4.2: Auto-merge a channel UID to a contact by phone number match.
 *
 * Called after OTP verification or when a LINE/FB webhook provides a verified phone.
 * Creates an IdentityMap entry. Uses confidence=1.0 for OTP-verified phones.
 *
 * @param tenantId    - Tenant scope
 * @param channelType - 'LINE' | 'FB' | etc.
 * @param uid         - Channel UID
 * @param phone       - Normalized phone number (E.164 format recommended)
 * @param isOtpVerified - If true, uses OTP_VERIFIED source; otherwise PHONE_MATCH
 * @returns Contact ID if merged, null if no match found
 */
export async function stitchByPhone(
  tenantId: string,
  channelType: ChannelType,
  uid: string,
  phone: string,
  isOtpVerified = false,
): Promise<string | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const contact = await prisma.contact.findFirst({
    where: { tenantId, phone: normalizedPhone },
  });

  if (!contact) {
    logger.debug(`[IdentityStitcher] No contact found for phone=${normalizedPhone}`);
    return null;
  }

  const source = isOtpVerified ? 'OTP_VERIFIED' : 'PHONE_MATCH';
  await upsertIdentityMap(tenantId, contact.id, channelType, uid, source);

  logger.info(
    `[IdentityStitcher] Stitched ${channelType} uid=${uid} to contact=${contact.id} via ${source}`,
  );
  return contact.id;
}

/**
 * Task 4.1 (continued): Check if a uid already exists in IdentityMap and return its contact.
 * Used at webhook entry to resolve an anonymous UID to a known contact.
 */
export async function resolveUidToContact(
  tenantId: string,
  channelType: ChannelType,
  uid: string,
): Promise<string | null> {
  const identityMap = await prisma.identityMap.findUnique({
    where: {
      tenantId_channelType_uid: { tenantId, channelType, uid },
    },
  });
  return identityMap?.contactId ?? null;
}

/**
 * Task 4.3 (detection step): Scan for contacts that share the same phone number across
 * different channels and generate MergeSuggestions if not yet suggested.
 *
 * Run as a background job (e.g. daily cron) or after a new stitchByPhone event.
 */
export async function detectPhoneDuplicates(tenantId: string): Promise<number> {
  // Find all contacts with the same phone in this tenant (not null)
  const contacts = await prisma.contact.findMany({
    where: { tenantId, phone: { not: null } },
    select: { id: true, phone: true },
  });

  const phoneMap = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.phone) continue;
    const key = normalizePhone(c.phone) ?? c.phone;
    if (!phoneMap.has(key)) phoneMap.set(key, []);
    phoneMap.get(key)!.push(c.id);
  }

  let created = 0;
  for (const [phone, ids] of phoneMap) {
    if (ids.length < 2) continue;
    // Create suggestion for first pair (primary = oldest/lower id, secondary = newer)
    const [primary, secondary] = ids;
    const existing = await prisma.mergeSuggestion.findFirst({
      where: {
        tenantId,
        primaryContactId: primary,
        secondaryContactId: secondary,
        status: 'PENDING',
      },
    });
    if (!existing) {
      await prisma.mergeSuggestion.create({
        data: {
          tenantId,
          primaryContactId: primary,
          secondaryContactId: secondary,
          reason: 'same_phone',
          confidence: 0.95,
          status: 'PENDING',
        },
      });
      created++;
      logger.info(`[IdentityStitcher] Created MergeSuggestion for phone ${phone}`);
    }
  }

  return created;
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function upsertIdentityMap(
  tenantId: string,
  contactId: string,
  channelType: ChannelType,
  uid: string,
  source: 'LIFF_COOKIE' | 'PHONE_MATCH' | 'EMAIL_MATCH' | 'MANUAL' | 'OTP_VERIFIED',
): Promise<void> {
  await prisma.identityMap.upsert({
    where: {
      tenantId_channelType_uid: { tenantId, channelType, uid },
    },
    create: {
      tenantId,
      contactId,
      channelType,
      uid,
      source,
      confidence: source === 'OTP_VERIFIED' ? 1.0 : 0.85,
    },
    update: {
      contactId,
      source,
      mergedAt: new Date(),
    },
  });
}

/** Normalize phone to remove spaces, dashes. Returns null if too short. */
function normalizePhone(phone: string): string | null {
  const normalized = phone.replace(/[\s\-().+]/g, '');
  return normalized.length >= 7 ? normalized : null;
}
