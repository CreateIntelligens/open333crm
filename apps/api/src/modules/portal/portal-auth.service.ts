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
