/**
 * 遷移腳本：將 channel credentials 從舊 key 重新加密為新 key
 *
 * 用法：
 *   npx tsx scripts/migrate-credential-key.ts
 *
 * 環境變數：
 *   OLD_KEY — 舊的加密金鑰（預設：poc-dev-secret-change-in-production，即之前的 JWT_SECRET）
 *   CREDENTIAL_KEY — 新的加密金鑰（必填）
 *   DATABASE_URL — 資料庫連線字串
 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'open333crm-credentials', 32);
}

function decrypt(encrypted: string, key: Buffer): Record<string, unknown> {
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function encrypt(plain: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

async function main() {
  const oldSecret = process.env.OLD_KEY ?? 'poc-dev-secret-change-in-production';
  const newSecret = process.env.CREDENTIAL_KEY;

  if (!newSecret) {
    console.error('❌ CREDENTIAL_KEY 環境變數未設定');
    process.exit(1);
  }

  console.log(`舊金鑰來源: OLD_KEY (${oldSecret.slice(0, 8)}...)`);
  console.log(`新金鑰來源: CREDENTIAL_KEY (${newSecret.slice(0, 8)}...)`);

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  const prisma = new PrismaClient();

  try {
    const channels = await prisma.channel.findMany({
      select: { id: true, displayName: true, channelType: true, credentialsEncrypted: true },
    });

    console.log(`\n找到 ${channels.length} 個 channel\n`);

    for (const ch of channels) {
      console.log(`[${ch.channelType}] ${ch.displayName} (${ch.id})`);

      let plainCredentials: Record<string, unknown>;

      // 嘗試用舊 key 解密
      try {
        plainCredentials = decrypt(ch.credentialsEncrypted, oldKey);
        console.log('  ✅ 舊金鑰解密成功');
      } catch {
        // 可能已經是用新 key 加密了，或者是未加密的 JSON
        try {
          plainCredentials = decrypt(ch.credentialsEncrypted, newKey);
          console.log('  ℹ️  已經使用新金鑰加密，跳過');
          continue;
        } catch {
          // 可能是未加密的 JSON（例如 WEBCHAT 的 {"mock":"true"}）
          try {
            plainCredentials = JSON.parse(ch.credentialsEncrypted);
            console.log('  ⚠️  未加密的 JSON，將進行加密');
          } catch {
            console.log('  ❌ 無法解密或解析，跳過');
            continue;
          }
        }
      }

      // 用新 key 重新加密
      const newEncrypted = encrypt(plainCredentials, newKey);
      await prisma.channel.update({
        where: { id: ch.id },
        data: { credentialsEncrypted: newEncrypted },
      });
      console.log('  ✅ 已用新金鑰重新加密');
    }

    console.log('\n🎉 遷移完成');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('遷移失敗:', e);
  process.exit(1);
});
