/**
 * Fan Portal authentication service.
 * Issues and verifies fan JWTs for public portal API access.
 */

import jwt from 'jsonwebtoken';
import { getConfig } from '../../config/env.js';

export interface FanPayload {
  sub: 'fan';
  contactId: string;
  tenantId: string;
}

/**
 * Sign a fan JWT (24h expiry).
 */
export function signFanToken(contactId: string, tenantId: string): string {
  const config = getConfig();
  const payload: FanPayload = { sub: 'fan', contactId, tenantId };
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Verify and decode a fan JWT. Returns null if invalid.
 */
export function verifyFanToken(token: string): FanPayload | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as FanPayload;
    if (decoded.sub !== 'fan') return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── 裝置憑證（add-coupon-system design D24）────────────────────────────────

/** 裝置憑證效期：顧客在這台裝置驗證過後，180 天內開啟自己的票券連結不必再驗證 */
export const FAN_DEVICE_TOKEN_TTL = '180d';
const FAN_DEVICE_TYPE = 'fan-device';

interface FanDevicePayload {
  typ: typeof FAN_DEVICE_TYPE;
  /** 聯絡人 */
  sub: string;
  /** 租戶 */
  tid: string;
}

/**
 * 簽發裝置憑證：證明「這台裝置曾以這位聯絡人的身分完成驗證」。
 * 只用來判斷開啟票券連結時要不要再驗證，不能當顧客憑證存取券夾（verifyFanToken 只接受 sub 為 'fan'）。
 */
export function signFanDeviceToken(contactId: string, tenantId: string): string {
  const payload: FanDevicePayload = { typ: FAN_DEVICE_TYPE, sub: contactId, tid: tenantId };
  return jwt.sign(payload, getConfig().JWT_SECRET, { expiresIn: FAN_DEVICE_TOKEN_TTL });
}

/** 驗證裝置憑證；簽章不符、過期或不是裝置憑證都回 null */
export function verifyFanDeviceToken(token: string): { contactId: string; tenantId: string } | null {
  try {
    const decoded = jwt.verify(token, getConfig().JWT_SECRET) as Partial<FanDevicePayload>;
    if (decoded.typ !== FAN_DEVICE_TYPE || typeof decoded.sub !== 'string' || typeof decoded.tid !== 'string') return null;
    return { contactId: decoded.sub, tenantId: decoded.tid };
  } catch {
    return null;
  }
}
