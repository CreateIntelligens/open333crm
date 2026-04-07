import { createDecipheriv, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key';
  return scryptSync(secret, 'open333crm-credentials', 32) as Buffer;
}

export function decryptCredentials(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}
