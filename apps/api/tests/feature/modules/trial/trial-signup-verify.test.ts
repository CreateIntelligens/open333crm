/**
 * 主規格 trial-application（change trial-set-password-after-verify，AUDIT TRIAL-05、TRIAL-06）。
 *
 * 申請 → 驗證信 → 驗證頁查詢連結 → 設定密碼並開通。直接呼叫 trial.service 的函式。
 * 大部分測試在交易內執行，結束時 rollback；service 內的 $transaction 以 savepoint 模擬，
 * 讓「中途失敗回滾」「email 衝突（P2002）」也有真實的回滾行為。
 * 「兩次同時送出」需要兩條連線才是真的併發，改用實際寫入，afterAll 清掉標記過的資料。
 *
 * 寄信換成 mock：從驗證信的連結取出 token，並計算寄出幾封。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { verifyPassword } from '#src/shared/utils/password.js';
import { getVerifyStatus, requestTrial, resendTrial, verifyAndProvision } from '#src/modules/trial/trial.service.js';
import { sendVerifyEmail } from '#src/modules/trial/trial-emails.js';

vi.mock('#src/modules/trial/trial-emails.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/trial/trial-emails.js')>()),
  sendVerifyEmail: vi.fn(async () => {}),
  sendProvisionedEmail: vi.fn(async () => {}),
}));

loadEnvConfig();

const prisma = new PrismaClient();
const MARK = `trial-sv-${Date.now()}`;

class Rollback extends Error {}

beforeEach(() => {
  vi.mocked(sendVerifyEmail).mockClear();
});

let seq = 0;

/** service 會呼叫 $transaction；交易內的 client 沒有這個方法，以 savepoint 模擬巢狀交易。 */
function withSavepoints(tx: PrismaClient, override: Partial<Record<keyof PrismaClient, unknown>> = {}): PrismaClient {
  let sp = 0;
  const proxy: PrismaClient = new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop in override) return override[prop as keyof PrismaClient];
      if (prop === '$transaction') {
        return async (fn: (inner: PrismaClient) => Promise<unknown>) => {
          const name = `sp_${sp++}`;
          await target.$executeRawUnsafe(`SAVEPOINT ${name}`);
          try {
            const result = await fn(proxy);
            await target.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (err) {
            await target.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
            throw err;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return proxy;
}

interface Fixture {
  tx: PrismaClient;
  db: PrismaClient;
  /** 本測試專用、不與其他測試重複的 email。 */
  email: string;
  tag: string;
  planId: string;
}

/** 在交易內執行，結束時 rollback。試用開啟，試用方案換成本測試建立的方案。 */
function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    // 交易一定以 Rollback 結束；其他錯誤（含 assertion）原樣拋出，報告才看得到失敗原因
    await assertRollback(
      prisma.$transaction(
        async (raw) => {
          const tx = raw as unknown as PrismaClient;
          const tag = `${MARK}-${seq++}`;
          const plan = await tx.plan.create({ data: { slug: tag, name: tag } });
          for (const [key, value] of [
            ['trial.enabled', true],
            ['trial.planSlug', tag],
            ['trial.durationDays', 14],
            ['trial.verifyTokenTtlHours', 24],
          ] as const) {
            await tx.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
          }
          await fn({ tx, db: withSavepoints(tx), email: `${tag}@example.test`, tag, planId: plan.id });
          throw new Rollback();
        },
        { timeout: 60_000 },
      ),
    );
  });
}

async function assertRollback(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  assert.fail('交易應以 Rollback 結束');
}

/** 從最近一封寄給 email 的驗證信取出 token。 */
function lastToken(email: string): string {
  const calls = vi.mocked(sendVerifyEmail).mock.calls.filter(([to]) => to === email);
  assert.ok(calls.length > 0, `沒有寄給 ${email} 的驗證信`);
  const url = new URL(calls.at(-1)![1].verifyUrl);
  return url.searchParams.get('token')!;
}

const sentTo = (email: string) => vi.mocked(sendVerifyEmail).mock.calls.filter(([to]) => to === email).length;

const signup = (tx: PrismaClient, email: string) =>
  tx.trialSignup.findFirstOrThrow({ where: { email } });

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** 舊前端仍可能送 password；service 的型別已不收，以 cast 模擬。 */
const apply = (db: PrismaClient, input: { email: string; siteName: string; password?: string }) =>
  requestTrial(db, input as Parameters<typeof requestTrial>[1]);

// ── TRIAL-05 ──

scenario('搶先申請的人無法決定管理員密碼', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '攻擊者的站台', password: 'Attacker-Pass-1' });
  await tx.trialSignup.update({ where: { emailNormalized: email }, data: { lastVerifySentAt: new Date(Date.now() - 120_000) } });
  await apply(db, { email, siteName: '本人的站台', password: 'Owner-Old-Pass-1' });

  const token = lastToken(email);
  const result = await verifyAndProvision(db, { token, password: 'Owner-Real-Pass-1', siteName: '本人的站台' });
  assert.equal(result.alreadyProvisioned, false);

  const agent = await tx.agent.findUniqueOrThrow({ where: { email } });
  assert.equal(await verifyPassword('Owner-Real-Pass-1', agent.passwordHash), true);
  assert.equal(await verifyPassword('Attacker-Pass-1', agent.passwordHash), false);
  assert.equal(await verifyPassword('Owner-Old-Pass-1', agent.passwordHash), false);
});

scenario('待驗證時以不同站台名稱再申請', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲', password: 'Password-1' });
  await tx.trialSignup.update({ where: { emailNormalized: email }, data: { lastVerifySentAt: new Date(Date.now() - 120_000) } });
  await apply(db, { email, siteName: '乙', password: 'Password-2' });

  const row = await signup(tx, email);
  assert.equal(row.siteName, '甲');
});

scenario('申請時送出的密碼被忽略', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲', password: 'Should-Not-Store-1' });

  const row = (await signup(tx, email)) as Record<string, unknown>;
  assert.equal('passwordHash' in row, false, '申請記錄不應存密碼');
});

// ── TRIAL-06 ──

scenario('待驗證時連續再申請受重寄節流', async ({ tx, db, email }) => {
  // 帶 password 模擬舊申請頁；新程式忽略它
  await apply(db, { email, siteName: '甲', password: 'Password-1' });
  for (let i = 0; i < 4; i++) await apply(db, { email, siteName: '甲', password: 'Password-1' });
  assert.equal(sentTo(email), 1, '60 秒內再申請不應寄信');

  // 冷卻過後再申請 → 依重寄規則寄出
  await tx.trialSignup.update({ where: { emailNormalized: email }, data: { lastVerifySentAt: new Date(Date.now() - 120_000) } });
  await apply(db, { email, siteName: '甲' });
  assert.equal(sentTo(email), 2);

  // 已達上限 5 次 → 再申請不寄
  await tx.trialSignup.update({
    where: { emailNormalized: email },
    data: { verifySentCount: 5, lastVerifySentAt: new Date(Date.now() - 120_000) },
  });
  await apply(db, { email, siteName: '甲' });
  assert.equal(sentTo(email), 2, '累計 5 次後不應再寄');
  assert.equal((await signup(tx, email)).verifySentCount, 5);
});

// ── 驗證頁查詢與開通 ──

scenario('查詢連結不消耗 token', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  const token = lastToken(email);

  for (let i = 0; i < 2; i++) {
    const status = await getVerifyStatus(db, token);
    assert.equal(status.status, 'pending');
    assert.equal(status.siteName, '甲');
    assert.equal(status.email, email);
  }
  assert.equal(await tx.agent.count({ where: { email } }), 0, '查詢不應開通');

  const result = await verifyAndProvision(db, { token, password: 'Password-OK-1' });
  assert.equal(result.alreadyProvisioned, false);
});

scenario('開通成功', async ({ tx, db, email, planId }) => {
  await apply(db, { email, siteName: '甲' });
  const result = await verifyAndProvision(db, { token: lastToken(email), password: 'Password-OK-1' });

  assert.equal(result.siteName, '甲');
  assert.match(result.loginUrl, /\/login$/);
  const agent = await tx.agent.findUniqueOrThrow({ where: { email }, include: { tenant: true } });
  assert.equal(agent.role, 'ADMIN');
  assert.equal(agent.tenant.planId, planId);
  assert.ok(agent.tenant.trialEndsAt, '試用租戶要有到期日');
  assert.equal(await verifyPassword('Password-OK-1', agent.passwordHash), true);
  const row = await signup(tx, email);
  assert.equal(row.status, 'provisioned');
  assert.equal(row.tenantId, agent.tenantId);
  assert.equal((await getVerifyStatus(db, lastToken(email))).status, 'provisioned');
});

scenario('驗證頁修改站台名稱', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  const result = await verifyAndProvision(db, { token: lastToken(email), password: 'Password-OK-1', siteName: '乙' });

  assert.equal(result.siteName, '乙');
  const agent = await tx.agent.findUniqueOrThrow({ where: { email }, include: { tenant: true } });
  assert.equal(agent.tenant.name, '乙');
  assert.equal((await signup(tx, email)).siteName, '乙');
});

scenario('同一 token 送出兩次', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  const token = lastToken(email);
  await verifyAndProvision(db, { token, password: 'Password-A-1' });
  const second = await verifyAndProvision(db, { token, password: 'Password-B-1' });

  assert.equal(second.alreadyProvisioned, true);
  assert.equal(await tx.tenant.count({ where: { agents: { some: { email } } } }), 1);
  const agent = await tx.agent.findUniqueOrThrow({ where: { email } });
  assert.equal(await verifyPassword('Password-A-1', agent.passwordHash), true);
  assert.equal(await verifyPassword('Password-B-1', agent.passwordHash), false);
});

scenario('改版前寄出的驗證連結', async ({ tx, db, email }) => {
  // 改版前的申請：直接寫入資料列，token 只存雜湊
  const token = crypto.randomBytes(32).toString('hex');
  await tx.trialSignup.create({
    data: {
      email,
      emailNormalized: email,
      siteName: '舊申請',
      verifyTokenHash: tokenHash(token),
      verifyTokenExpiresAt: new Date(Date.now() + 3600_000),
      verifySentCount: 1,
      lastVerifySentAt: new Date(Date.now() - 3600_000),
    },
  });

  assert.equal((await getVerifyStatus(db, token)).status, 'pending');
  await verifyAndProvision(db, { token, password: 'Password-New-1' });
  const agent = await tx.agent.findUniqueOrThrow({ where: { email } });
  assert.equal(await verifyPassword('Password-New-1', agent.passwordHash), true);
});

scenario('開通中途失敗可重試', async ({ tx, email }) => {
  let failOnce = true;
  const agent = new Proxy(tx.agent, {
    get(target, prop, receiver) {
      if (prop === 'create' && failOnce) {
        return async () => {
          failOnce = false;
          throw new Error('暫時性錯誤');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const db = withSavepoints(tx, { agent });

  await apply(db, { email, siteName: '甲' });
  const token = lastToken(email);
  await assert.rejects(verifyAndProvision(db, { token, password: 'Password-OK-1' }), /暫時性錯誤/);
  assert.equal((await signup(tx, email)).status, 'pending_verification', '失敗後要回到待驗證');

  const result = await verifyAndProvision(db, { token, password: 'Password-OK-1' });
  assert.equal(result.alreadyProvisioned, false);
  assert.equal(await tx.agent.count({ where: { email } }), 1);
});

scenario('email 已被其他租戶建走', async ({ tx, db, email, tag }) => {
  await apply(db, { email, siteName: '甲' });
  const token = lastToken(email);
  const other = await tx.tenant.create({ data: { name: tag } });
  await tx.agent.create({ data: { tenantId: other.id, email, name: tag, role: 'AGENT', passwordHash: 'x' } });

  await assert.rejects(verifyAndProvision(db, { token, password: 'Password-OK-1' }), { code: 'EMAIL_IN_USE' });
  assert.equal((await signup(tx, email)).status, 'failed');
});

// ── token 時效 ──

scenario('過期 token', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  const token = lastToken(email);
  await tx.trialSignup.update({ where: { emailNormalized: email }, data: { verifyTokenExpiresAt: new Date(Date.now() - 1000) } });

  await assert.rejects(getVerifyStatus(db, token), { code: 'TRIAL_TOKEN_EXPIRED', statusCode: 410 });
  await assert.rejects(verifyAndProvision(db, { token, password: 'Password-OK-1' }), { code: 'TRIAL_TOKEN_EXPIRED', statusCode: 410 });
  assert.equal(await tx.agent.count({ where: { email } }), 0);
});

scenario('重寄後舊連結失效', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  const oldToken = lastToken(email);
  await tx.trialSignup.update({ where: { emailNormalized: email }, data: { lastVerifySentAt: new Date(Date.now() - 120_000) } });
  await resendTrial(db, email);
  assert.notEqual(lastToken(email), oldToken);

  await assert.rejects(getVerifyStatus(db, oldToken), { code: 'TRIAL_TOKEN_INVALID', statusCode: 410 });
  await assert.rejects(verifyAndProvision(db, { token: oldToken, password: 'Password-OK-1' }), { code: 'TRIAL_TOKEN_INVALID' });
});

scenario('無效 token', async ({ tx, db, email }) => {
  const token = crypto.randomBytes(32).toString('hex');
  await assert.rejects(getVerifyStatus(db, token), { code: 'TRIAL_TOKEN_INVALID', statusCode: 410 });
  await assert.rejects(verifyAndProvision(db, { token, password: 'Password-OK-1' }), { code: 'TRIAL_TOKEN_INVALID' });
  assert.equal(await tx.agent.count({ where: { email } }), 0);
});

// ── 總開關與防枚舉 ──

scenario('總開關關閉', async ({ tx, db, email }) => {
  await tx.platformSetting.update({ where: { key: 'trial.enabled' }, data: { value: false } });
  await assert.rejects(apply(db, { email, siteName: '甲' }), { code: 'TRIAL_CLOSED' });
  assert.equal(await tx.trialSignup.count({ where: { email } }), 0);
});

scenario('關閉後既有驗證信仍可完成開通', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  await tx.platformSetting.update({ where: { key: 'trial.enabled' }, data: { value: false } });

  const token = lastToken(email);
  assert.equal((await getVerifyStatus(db, token)).status, 'pending');
  const result = await verifyAndProvision(db, { token, password: 'Password-OK-1' });
  assert.equal(result.alreadyProvisioned, false);
});

scenario('已開通過的 email 再申請', async ({ tx, db, email }) => {
  await apply(db, { email, siteName: '甲' });
  await verifyAndProvision(db, { token: lastToken(email), password: 'Password-OK-1' });
  // 已是 Agent 的檢查先擋住，所以把 agent 的 email 換掉，確認是 provisioned 狀態在擋
  await tx.agent.update({ where: { email }, data: { email: `moved-${email}` } });

  await apply(db, { email, siteName: '乙' });
  assert.equal(sentTo(email), 1);
  assert.equal(await tx.trialSignup.count({ where: { emailNormalized: email } }), 1);
  assert.equal((await signup(tx, email)).siteName, '甲');
});

scenario('gmail 別名重複申請', async ({ tx, db, tag }) => {
  const local = tag.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const email = `${local}@gmail.com`;
  await apply(db, { email, siteName: '甲' });
  await apply(db, { email: `${local[0]}.${local.slice(1)}+demo@gmail.com`, siteName: '乙' });

  const rows = await tx.trialSignup.findMany({ where: { emailNormalized: email } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.siteName, '甲');
});

// ── 真正的併發：兩條連線同時送出 ──

const created = { tenantIds: [] as string[], planSlug: null as string | null };

test('同一 token 兩次同時送出只開通一次', async () => {
  const email = `${MARK}-concurrent@example.test`;
  const token = crypto.randomBytes(32).toString('hex');
  // verifyAndProvision 不看 trial.enabled，只需要試用方案存在
  const policySlug = ((await prisma.platformSetting.findUnique({ where: { key: 'trial.planSlug' } }))?.value as string) ?? 'trial';
  if (!(await prisma.plan.findUnique({ where: { slug: policySlug } }))) {
    await prisma.plan.create({ data: { slug: policySlug, name: MARK } });
    created.planSlug = policySlug;
  }
  await prisma.trialSignup.create({
    data: {
      email,
      emailNormalized: email,
      siteName: MARK,
      verifyTokenHash: tokenHash(token),
      verifyTokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });

  const results = await Promise.allSettled([
    verifyAndProvision(prisma, { token, password: 'Password-A-1' }),
    verifyAndProvision(prisma, { token, password: 'Password-B-1' }),
  ]);
  const agents = await prisma.agent.findMany({ where: { email } });
  created.tenantIds.push(...agents.map((a) => a.tenantId));

  assert.equal(agents.length, 1, '只能建立一個管理員');
  const fresh = results.filter((r) => r.status === 'fulfilled' && !r.value.alreadyProvisioned);
  assert.equal(fresh.length, 1, '只有一次是實際開通');
  const okA = await verifyPassword('Password-A-1', agents[0]!.passwordHash);
  const okB = await verifyPassword('Password-B-1', agents[0]!.passwordHash);
  assert.equal(okA !== okB, true, '密碼是兩者之一');
});

afterAll(async () => {
  for (const tenantId of created.tenantIds) {
    await prisma.agent.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
  await prisma.trialSignup.deleteMany({ where: { email: { startsWith: MARK } } });
  if (created.planSlug) await prisma.plan.deleteMany({ where: { slug: created.planSlug, name: MARK } });
  await prisma.$disconnect();
});
