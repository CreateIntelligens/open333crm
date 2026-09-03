import { randomInt } from 'node:crypto';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 產生高熵臨時密碼（英數混合，排除易混淆字元 0/O/1/l/I），供系統開通/重寄開通信寄送。 */
export function generateTempPassword(length = 14): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}
