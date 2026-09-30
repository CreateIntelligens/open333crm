/**
 * 統一聯絡人合併引擎（change add-cross-channel-one-id，design D5 / D8）。
 *
 * 所有合併路徑（手動合併、合併建議、LINE Login、FB Login、綁定代碼）一律走這裡，
 * 確保「每張帶 contactId 的表」都被搬到存續聯絡人（survivor），被合併方（merged）
 * 只封存不刪除，並把搬了哪些 id 記進 ContactMergeLog，供稽核與解除合併使用。
 *
 * 新增帶 contactId 的表時，必須同步更新本檔的搬移清單（否則合併後資料會留在封存聯絡人上）。
 *
 * 兩個函式都必須在呼叫端的交易內執行（withTenant 的 tx，或白名單路徑的 prismaAdmin.$transaction），
 * 本檔不自開交易，避免巢狀。
 */

import type { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { addPointTransaction, getLatestPointEntry } from '../portal/points.service.js';

export type MergeSource = 'MANUAL' | 'SUGGESTION' | 'LINE_LOGIN' | 'FB_LOGIN' | 'BINDING_CODE';

/** 單次合併搬移的紀錄（存於 ContactMergeLog.movedRecords） */
export interface MovedRecords {
  channelIdentity: string[];
  conversation: string[];
  case: string[];
  longTermMemory: string[];
  portalSubmission: string[];
  /** 舊版合併直接搬移的點數交易 id（已不再使用，保留供解除舊紀錄） */
  pointTransaction: string[];
  /** 由被合併方轉入 survivor 的點數（點數帳本為 append-only，以轉出／轉入兩筆交易處理） */
  pointsTransferred?: number;
  identityMap: string[];
  clickLog: string[];
  flowExecution: string[];
  kbArticleFeedback: string[];
  broadcastRecipient: string[];
  /** 搬過去的 tagId（解除時不回收） */
  contactTag: string[];
  /** 搬過去的屬性 key（解除時不回收） */
  contactAttribute: string[];
  /** survivor 原本為空、由 merged 補上的欄位名稱 */
  filledFields: string[];
  /** 合併時搬移或因重複而刪除的聯絡人關係（原貌），解除時還原 */
  contactRelations?: {
    updated: Array<{ id: string; fromContactId: string; toContactId: string; relationType: string }>;
    deleted: Array<{ fromContactId: string; toContactId: string; relationType: string; notes: string | null }>;
  };
  /** 原本 mergedIntoId 指向被合併方、合併時改指 survivor 的聯絡人（解除時改回） */
  repointedContacts?: string[];
  /** 呼叫端附加的脈絡（例如綁定代碼的發碼身分），供解除時判斷用 */
  meta?: { issuerChannelIdentityId?: string };
}

export interface MergeContactsInput {
  tenantId: string;
  survivorId: string;
  mergedId: string;
  source: MergeSource;
  actorAgentId?: string;
  meta?: MovedRecords['meta'];
}

export interface MergeContactsResult {
  mergeLogId: string;
  survivor: { id: string; displayName: string };
  merged: { id: string; displayName: string };
  moved: MovedRecords;
}

/**
 * 撤銷時要搬回的表。標籤／屬性不回收（合併後無法判斷是誰加的，見 design D8）；
 * 其餘屬於被合併方的紀錄都要搬回——特別是 AI 長期記憶，留在 survivor 身上等於把
 * 對方的個資留給另一個人（綁定被冒用時更嚴重）。
 */
type RevertibleKey =
  | 'channelIdentity'
  | 'conversation'
  | 'case'
  | 'longTermMemory'
  | 'portalSubmission'
  | 'pointTransaction'
  | 'identityMap'
  | 'clickLog'
  | 'flowExecution'
  | 'kbArticleFeedback'
  | 'broadcastRecipient';

async function moveIds(
  find: () => Promise<Array<{ id: string }>>,
  update: (ids: string[]) => Promise<unknown>,
): Promise<string[]> {
  const ids = (await find()).map((r) => r.id);
  if (ids.length > 0) await update(ids);
  return ids;
}

/**
 * 沿 mergedIntoId 走完合併鏈：回傳從 contactId 開始、依序被併入的聯絡人 id（最後一個是目前持有者）。
 * 有環或超過 20 層即停止。解除合併與綁定兌換都用這支，避免兩份邏輯漂移。
 */
export async function resolveMergeChain(db: TenantDb, tenantId: string, contactId: string): Promise<string[]> {
  const chain = [contactId];
  let cursor = contactId;
  for (let i = 0; i < 20; i++) {
    const c = await db.contact.findFirst({ where: { id: cursor, tenantId }, select: { mergedIntoId: true } });
    if (!c?.mergedIntoId || chain.includes(c.mergedIntoId)) break;
    cursor = c.mergedIntoId;
    chain.push(cursor);
  }
  return chain;
}

/**
 * 以兩筆交易把點數從 from 轉到 to（append-only 帳本）。回傳實際轉移的點數。
 * amount 省略時轉出 from 的全部餘額。createdAt 明確取在雙方最新交易之後，
 * 避免同一交易內寫入的多筆 now() 時間相同，讓「取最新一筆」的餘額計算不確定。
 */
async function transferPoints(
  db: TenantDb,
  tenantId: string,
  fromId: string,
  toId: string,
  reason: 'merge' | 'revert',
  amount?: number,
  expected?: number,
): Promise<number> {
  const [from, to] = await Promise.all([
    getLatestPointEntry(db, fromId, tenantId),
    getLatestPointEntry(db, toId, tenantId),
  ]);
  const fromBalance = from?.balance ?? 0;
  const value = amount ?? fromBalance;
  if (value <= 0) return 0;

  const floor = Math.max(from?.createdAt.getTime() ?? 0, to?.createdAt.getTime() ?? 0);
  const createdAt = new Date(Math.max(Date.now(), floor + 1));
  const partial = expected !== undefined && value < expected ? `（原轉入 ${expected} 點，合併後已使用部分，僅轉回 ${value} 點）` : '';
  const note = reason === 'merge' ? '聯絡人合併：點數轉移' : `解除合併：點數轉回${partial}`;

  // 帳本寫入規則只在 points.service 一處（取最新餘額 + amount）
  await addPointTransaction(db, { tenantId, contactId: fromId, amount: -value, type: `${reason}_transfer_out`, note, createdAt });
  await addPointTransaction(db, { tenantId, contactId: toId, amount: value, type: `${reason}_transfer_in`, note, createdAt });
  return value;
}

/**
 * 將 mergedId 合併進 survivorId。
 *
 * @param db 呼叫端交易內的 Prisma 執行器
 * @returns 合併紀錄 id、雙方名稱與搬移明細
 */
export async function mergeContacts(db: TenantDb, input: MergeContactsInput): Promise<MergeContactsResult> {
  const { tenantId, survivorId, mergedId, source, actorAgentId, meta } = input;

  if (survivorId === mergedId) {
    throw new AppError('無法將聯絡人與自己合併', 'BAD_REQUEST', 400);
  }

  const [survivor, merged] = await Promise.all([
    db.contact.findFirst({ where: { id: survivorId, tenantId } }),
    db.contact.findFirst({ where: { id: mergedId, tenantId } }),
  ]);
  if (!survivor || !merged) {
    throw new AppError('找不到要合併的聯絡人', 'NOT_FOUND', 404);
  }
  if (survivor.isArchived) {
    throw new AppError('目標聯絡人已被封存或合併，無法作為合併對象', 'BAD_REQUEST', 400);
  }
  if (merged.isArchived) {
    throw new AppError('此聯絡人已被封存或合併，無法再次合併', 'BAD_REQUEST', 400);
  }
  // 以條件式更新鎖定雙方：上面的檢查只是讀取，同時進來的合併會都通過。
  // - 被合併方：只有一個交易能把 isArchived 從 false 改成 true
  // - survivor：也要鎖住（碰一下 updatedAt 取得列鎖），否則另一個交易同時把 survivor 併入別人，
  //   本次搬過去的資料會落在已封存的聯絡人上
  // 依 id 排序鎖定，避免「A 併入 B」與「B 併入 A」同時進行時互相等待而死結
  const now = new Date();
  for (const id of [survivorId, mergedId].sort()) {
    const locked = await db.contact.updateMany({
      where: { id, tenantId, isArchived: false },
      data: id === mergedId ? { isArchived: true, mergedIntoId: survivorId } : { updatedAt: now },
    });
    if (locked.count === 0) {
      throw new AppError('聯絡人已被封存或合併，請重新整理後再試', 'CONFLICT', 409);
    }
  }

  const to = { contactId: survivorId };

  // ── 1. 直接改指 survivor 的表 ──────────────────────────────────────────
  const channelIdentity = await moveIds(
    () => db.channelIdentity.findMany({ where: { contactId: mergedId }, select: { id: true } }),
    (ids) => db.channelIdentity.updateMany({ where: { id: { in: ids } }, data: to }),
  );
  const conversation = await moveIds(
    () => db.conversation.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.conversation.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
  const cases = await moveIds(
    () => db.case.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.case.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
  const longTermMemory = await moveIds(
    () => db.longTermMemory.findMany({ where: { contactId: mergedId }, select: { id: true } }),
    (ids) => db.longTermMemory.updateMany({ where: { id: { in: ids } }, data: to }),
  );
  const portalSubmission = await moveIds(
    () => db.portalSubmission.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.portalSubmission.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
  // 點數帳本是 append-only、每筆記錄當下餘額（getPointBalance 取最新一筆的 balance），
  // 直接搬交易會讓餘額變成「兩人裡最新那筆」→ 改為被合併方轉出、survivor 轉入
  const pointsTransferred = await transferPoints(db, tenantId, mergedId, survivorId, 'merge');
  const pointTransaction: string[] = [];
  const identityMap = await moveIds(
    () => db.identityMap.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.identityMap.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
  const clickLog = await moveIds(
    () => db.clickLog.findMany({ where: { contactId: mergedId }, select: { id: true } }),
    (ids) => db.clickLog.updateMany({ where: { id: { in: ids } }, data: to }),
  );
  const flowExecution = await moveIds(
    () => db.flowExecution.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.flowExecution.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
  const kbArticleFeedback = await moveIds(
    () => db.kbArticleFeedback.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.kbArticleFeedback.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );

  // ── 2. 有唯一鍵的表：survivor 已有的保留 survivor，其餘搬過去 ─────────────
  // 標籤：唯一鍵 [contactId, tagId]；用 updateMany 搬才能保留 addedAt / expiresAt
  const [mergedTags, survivorTags] = await Promise.all([
    db.contactTag.findMany({ where: { contactId: mergedId }, select: { tagId: true } }),
    db.contactTag.findMany({ where: { contactId: survivorId }, select: { tagId: true } }),
  ]);
  const survivorTagIds = new Set(survivorTags.map((t) => t.tagId));
  const contactTag = mergedTags.map((t) => t.tagId).filter((id) => !survivorTagIds.has(id));
  if (contactTag.length > 0) {
    await db.contactTag.updateMany({ where: { contactId: mergedId, tagId: { in: contactTag } }, data: to });
  }
  // 重複的標籤留在封存聯絡人上會讓標籤人數重複計算，刪除
  await db.contactTag.deleteMany({ where: { contactId: mergedId } });

  // 屬性：唯一鍵 [contactId, key]，衝突時 survivor 優先
  const [mergedAttrs, survivorAttrs] = await Promise.all([
    db.contactAttribute.findMany({ where: { contactId: mergedId }, select: { key: true } }),
    db.contactAttribute.findMany({ where: { contactId: survivorId }, select: { key: true } }),
  ]);
  const survivorKeys = new Set(survivorAttrs.map((a) => a.key));
  const contactAttribute = mergedAttrs.map((a) => a.key).filter((k) => !survivorKeys.has(k));
  if (contactAttribute.length > 0) {
    await db.contactAttribute.updateMany({
      where: { contactId: mergedId, key: { in: contactAttribute } },
      data: to,
    });
  }
  await db.contactAttribute.deleteMany({ where: { contactId: mergedId } });

  // 廣播收件紀錄：唯一鍵 [broadcastId, contactId]；雙方都收過同一則廣播時保留在原聯絡人，
  // 不刪除（刪了會讓廣播送達統計少算）
  const [mergedRecipients, survivorRecipients] = await Promise.all([
    db.broadcastRecipient.findMany({ where: { contactId: mergedId }, select: { id: true, broadcastId: true } }),
    db.broadcastRecipient.findMany({ where: { contactId: survivorId }, select: { broadcastId: true } }),
  ]);
  const survivorBroadcastIds = new Set(survivorRecipients.map((r) => r.broadcastId));
  const broadcastRecipient = mergedRecipients
    .filter((r) => !survivorBroadcastIds.has(r.broadcastId))
    .map((r) => r.id);
  if (broadcastRecipient.length > 0) {
    await db.broadcastRecipient.updateMany({ where: { id: { in: broadcastRecipient } }, data: to });
  }

  // 聯絡人關係：唯一鍵 [from, to, relationType]；會變成自我關聯或重複的直接刪除
  const relations = await db.contactRelation.findMany({
    where: { OR: [{ fromContactId: mergedId }, { toContactId: mergedId }] },
  });
  // 每一筆的原貌都記下來（搬移的記 id 與原端點、刪除的記完整內容），解除時才能還原
  const contactRelations: NonNullable<MovedRecords['contactRelations']> = { updated: [], deleted: [] };
  for (const rel of relations) {
    const fromContactId = rel.fromContactId === mergedId ? survivorId : rel.fromContactId;
    const toContactId = rel.toContactId === mergedId ? survivorId : rel.toContactId;
    const duplicate =
      fromContactId === toContactId ||
      (await db.contactRelation.findFirst({
        where: { fromContactId, toContactId, relationType: rel.relationType, NOT: { id: rel.id } },
        select: { id: true },
      }));
    const original = { fromContactId: rel.fromContactId, toContactId: rel.toContactId, relationType: rel.relationType };
    if (duplicate) {
      await db.contactRelation.delete({ where: { id: rel.id } });
      contactRelations.deleted.push({ ...original, notes: rel.notes });
    } else {
      await db.contactRelation.update({ where: { id: rel.id }, data: { fromContactId, toContactId } });
      contactRelations.updated.push({ id: rel.id, ...original });
    }
  }

  // ── 3. 其他指向 merged 的紀錄 ─────────────────────────────────────────
  // 尚待審核、涉及 merged 的合併建議已失去意義
  await db.mergeSuggestion.updateMany({
    where: {
      tenantId,
      status: 'PENDING',
      OR: [{ primaryContactId: mergedId }, { secondaryContactId: mergedId }],
    },
    data: { status: 'SUPERSEDED' },
  });
  // 先前併入 merged 的聯絡人改指 survivor，讓 mergedIntoId 不形成長鏈；記下來，解除時改回指向 merged
  const repointedContacts = await moveIds(
    () => db.contact.findMany({ where: { tenantId, mergedIntoId: mergedId }, select: { id: true } }),
    (ids) => db.contact.updateMany({ where: { tenantId, id: { in: ids } }, data: { mergedIntoId: survivorId } }),
  );

  // ── 4. survivor 補空欄、封存 merged ────────────────────────────────────
  const fill: Prisma.ContactUpdateInput = {};
  const filledFields: string[] = [];
  if (!survivor.phone && merged.phone) {
    fill.phone = merged.phone;
    filledFields.push('phone');
  }
  if (!survivor.email && merged.email) {
    fill.email = merged.email;
    filledFields.push('email');
  }
  if (!survivor.avatarUrl && merged.avatarUrl) {
    fill.avatarUrl = merged.avatarUrl;
    filledFields.push('avatarUrl');
  }
  if (!survivor.displayName.trim() && merged.displayName.trim()) {
    fill.displayName = merged.displayName;
    filledFields.push('displayName');
  }
  if (filledFields.length > 0) {
    await db.contact.update({ where: { id: survivorId, tenantId }, data: fill });
  }
  const moved: MovedRecords = {
    channelIdentity,
    conversation,
    case: cases,
    longTermMemory,
    portalSubmission,
    pointTransaction,
    pointsTransferred,
    identityMap,
    clickLog,
    flowExecution,
    kbArticleFeedback,
    broadcastRecipient,
    contactTag,
    contactAttribute,
    filledFields,
    repointedContacts,
    contactRelations,
    ...(meta ? { meta } : {}),
  };

  const log = await db.contactMergeLog.create({
    data: {
      tenantId,
      survivorId,
      mergedId,
      source,
      actorAgentId: actorAgentId ?? null,
      movedRecords: moved as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    mergeLogId: log.id,
    survivor: { id: survivor.id, displayName: fill.displayName ? merged.displayName : survivor.displayName },
    merged: { id: merged.id, displayName: merged.displayName },
    moved,
  };
}

export interface RevertMergeInput {
  tenantId: string;
  mergeLogId: string;
  /** agentId，或顧客自助解除時為 'customer' */
  revertedBy: string;
}

export interface RevertMergeResult {
  survivorId: string;
  /** 目前實際持有資料的聯絡人（survivor 若之後又被併入別人，則為最終的那一位） */
  holderId: string;
  restoredContactId: string;
  source: string;
}

/**
 * 解除一次合併：取消封存被合併方，把當次搬走且仍在 survivor（或其後續合併對象）身上的
 * 渠道身分、對話、案件、活動報名、點數、身分對應搬回。標籤與屬性不回收。
 */
export async function revertMerge(db: TenantDb, input: RevertMergeInput): Promise<RevertMergeResult> {
  const { tenantId, mergeLogId, revertedBy } = input;

  const log = await db.contactMergeLog.findFirst({ where: { id: mergeLogId, tenantId } });
  if (!log) throw new AppError('找不到此合併紀錄', 'NOT_FOUND', 404);
  if (log.revertedAt) throw new AppError('此合併已經解除過了', 'CONFLICT', 409);

  const restored = await db.contact.findFirst({ where: { id: log.mergedId, tenantId } });
  if (!restored) throw new AppError('被合併的聯絡人已不存在，無法解除', 'NOT_FOUND', 404);

  // 先以條件式更新佔用這筆紀錄：顧客自助解除與客服解除同時進來時，只有一個能繼續，
  // 否則兩邊都會轉回點數（被恢復方拿到兩倍、持有方被扣兩次）
  const claimed = await db.contactMergeLog.updateMany({
    where: { id: log.id, tenantId, revertedAt: null },
    data: { revertedAt: new Date(), revertedBy },
  });
  if (claimed.count === 0) throw new AppError('此合併已經解除過了', 'CONFLICT', 409);

  // survivor 之後可能又被併入別人：沿 mergedIntoId 找出目前持有資料的聯絡人鏈
  const holderChain = await resolveMergeChain(db, tenantId, log.survivorId);

  const moved = log.movedRecords as unknown as Partial<MovedRecords>;
  const back = { contactId: log.mergedId };
  const heldBy = { in: holderChain };
  const ids = (key: RevertibleKey) => moved[key] ?? [];

  const inList = (key: RevertibleKey) => ({ in: ids(key) });
  const has = (key: RevertibleKey) => ids(key).length > 0;

  if (has('channelIdentity')) {
    await db.channelIdentity.updateMany({ where: { id: inList('channelIdentity'), contactId: heldBy }, data: back });
  }
  if (has('conversation')) {
    await db.conversation.updateMany({ where: { tenantId, id: inList('conversation'), contactId: heldBy }, data: back });
  }
  if (has('case')) {
    await db.case.updateMany({ where: { tenantId, id: inList('case'), contactId: heldBy }, data: back });
  }
  if (has('longTermMemory')) {
    await db.longTermMemory.updateMany({ where: { id: inList('longTermMemory'), contactId: heldBy }, data: back });
  }
  if (has('portalSubmission')) {
    await db.portalSubmission.updateMany({ where: { tenantId, id: inList('portalSubmission'), contactId: heldBy }, data: back });
  }
  if (has('pointTransaction')) {
    // 舊版合併紀錄（直接搬移交易）才會有
    await db.pointTransaction.updateMany({ where: { tenantId, id: inList('pointTransaction'), contactId: heldBy }, data: back });
  }
  if (moved.pointsTransferred && moved.pointsTransferred > 0) {
    // 把當初轉入的點數轉回；survivor 若在合併後已用掉一部分，只轉回剩餘的
    const holderId = holderChain[holderChain.length - 1];
    const holderBalance = (await getLatestPointEntry(db, holderId, tenantId))?.balance ?? 0;
    const amount = Math.min(moved.pointsTransferred, Math.max(holderBalance, 0));
    if (amount > 0) {
      await transferPoints(db, tenantId, holderId, log.mergedId, 'revert', amount, moved.pointsTransferred);
      // 這些點數當初是經由後續的合併（survivor → … → 持有者）一路轉過去的；那些合併紀錄記的
      // pointsTransferred 包含了這筆，扣掉，否則之後再解除它們會把同一批點數再轉一次
      for (let i = 0; i < holderChain.length - 1; i++) {
        const later = await db.contactMergeLog.findFirst({
          where: { tenantId, mergedId: holderChain[i], survivorId: holderChain[i + 1], revertedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        const laterMoved = later?.movedRecords as unknown as Partial<MovedRecords> | undefined;
        if (later && laterMoved?.pointsTransferred) {
          await db.contactMergeLog.update({
            where: { id: later.id, tenantId },
            data: {
              movedRecords: {
                ...laterMoved,
                pointsTransferred: Math.max(0, laterMoved.pointsTransferred - amount),
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }
    }
  }
  if (has('identityMap')) {
    await db.identityMap.updateMany({ where: { tenantId, id: inList('identityMap'), contactId: heldBy }, data: back });
  }
  if (has('clickLog')) {
    await db.clickLog.updateMany({ where: { id: inList('clickLog'), contactId: heldBy }, data: back });
  }
  if (has('flowExecution')) {
    await db.flowExecution.updateMany({ where: { tenantId, id: inList('flowExecution'), contactId: heldBy }, data: back });
  }
  if (has('kbArticleFeedback')) {
    await db.kbArticleFeedback.updateMany({ where: { tenantId, id: inList('kbArticleFeedback'), contactId: heldBy }, data: back });
  }
  if (has('broadcastRecipient')) {
    await db.broadcastRecipient.updateMany({ where: { id: inList('broadcastRecipient'), contactId: heldBy }, data: back });
  }

  // 合併「之後」才在 survivor 上新開、屬於被搬回渠道的對話與案件（不在 movedRecords 裡），
  // 也要跟著渠道身分回去；否則對話的聯絡人身上已沒有該渠道身分，客服回覆會送不出去。
  // 只處理「持有方在該渠道已沒有任何身分」的渠道：若持有方自己在同一渠道也有身分
  // （手動合併不擋同渠道），無法分辨新對話屬於哪個人，寧可不搬也不搬錯
  const [restoredIdentities, holderIdentities] = await Promise.all([
    db.channelIdentity.findMany({ where: { contactId: log.mergedId }, select: { channelId: true } }),
    db.channelIdentity.findMany({ where: { contactId: heldBy }, select: { channelId: true } }),
  ]);
  const holderChannels = new Set(holderIdentities.map((c) => c.channelId));
  const restoredChannels = restoredIdentities.map((c) => c.channelId).filter((id) => !holderChannels.has(id));
  if (restoredChannels.length > 0) {
    const sinceMerge = { gte: log.createdAt };
    await db.conversation.updateMany({
      where: { tenantId, contactId: heldBy, channelId: { in: restoredChannels }, createdAt: sinceMerge },
      data: back,
    });
    await db.case.updateMany({
      where: { tenantId, contactId: heldBy, channelId: { in: restoredChannels }, createdAt: sinceMerge },
      data: back,
    });
  }

  // 搬回的渠道身分，其 IdentityMap 對應（含合併後才寫入的，例如綁定代碼的 BINDING_CODE 紀錄）
  // 也要指回被恢復的聯絡人，否則之後該 uid 進站會被解析回 survivor
  if (ids('channelIdentity').length > 0) {
    const identities = await db.channelIdentity.findMany({
      where: { id: { in: ids('channelIdentity') }, contactId: log.mergedId },
      select: { channelType: true, uid: true },
    });
    for (const identity of identities) {
      await db.identityMap.updateMany({
        where: { tenantId, channelType: identity.channelType, uid: identity.uid, contactId: heldBy },
        data: back,
      });
    }
  }

  // 合併時從被合併方補到 survivor 的電話／email／頭像／名稱，解除後不可留在對方身上（個資）。
  // survivor 之後若又被併入別人，這些值可能再被補到後續持有者身上 → 整條合併鏈都要清。
  // 只清「仍是當時補上的值」的欄位：合併後客服或顧客自己改過的就不動
  const filled = moved.filledFields ?? [];
  if (filled.length > 0) {
    const restoredContact = await db.contact.findFirst({ where: { id: log.mergedId, tenantId } });
    if (restoredContact) {
      const holders = await db.contact.findMany({ where: { tenantId, id: { in: holderChain } } });
      for (const holder of holders) {
        const clear: Prisma.ContactUpdateInput = {};
        for (const field of filled) {
          if (field === 'phone' && restoredContact.phone && holder.phone === restoredContact.phone) clear.phone = null;
          if (field === 'email' && restoredContact.email && holder.email === restoredContact.email) clear.email = null;
          if (field === 'avatarUrl' && restoredContact.avatarUrl && holder.avatarUrl === restoredContact.avatarUrl) {
            clear.avatarUrl = null;
          }
          // displayName 為必填，只在合併前 survivor 名稱為空白時才補過；清回空字串
          if (field === 'displayName' && holder.displayName === restoredContact.displayName) clear.displayName = '';
        }
        if (Object.keys(clear).length > 0) {
          await db.contact.update({ where: { id: holder.id, tenantId }, data: clear });
        }
      }
    }
  }

  await db.contact.update({
    where: { id: log.mergedId, tenantId },
    data: { isArchived: false, mergedIntoId: null },
  });
  // 聯絡人關係還原：搬移過的改回原端點（若該位置已有同樣的關係就略過，避免撞唯一鍵），刪除的重建
  if (moved.contactRelations) {
    for (const rel of moved.contactRelations.updated) {
      const exists = await db.contactRelation.findFirst({
        where: { fromContactId: rel.fromContactId, toContactId: rel.toContactId, relationType: rel.relationType },
        select: { id: true },
      });
      if (!exists) {
        await db.contactRelation.updateMany({
          where: { id: rel.id },
          data: { fromContactId: rel.fromContactId, toContactId: rel.toContactId },
        });
      }
    }
    for (const rel of moved.contactRelations.deleted) {
      const exists = await db.contactRelation.findFirst({
        where: { fromContactId: rel.fromContactId, toContactId: rel.toContactId, relationType: rel.relationType },
        select: { id: true },
      });
      if (!exists) await db.contactRelation.create({ data: rel });
    }
  }

  // 合併時被「壓平」改指 survivor 的聯絡人改回指向被恢復方，合併鏈才會正確
  if (moved.repointedContacts?.length) {
    await db.contact.updateMany({
      where: { tenantId, id: { in: moved.repointedContacts }, mergedIntoId: heldBy },
      data: { mergedIntoId: log.mergedId },
    });
  }

  return {
    survivorId: log.survivorId,
    holderId: holderChain[holderChain.length - 1],
    restoredContactId: log.mergedId,
    source: log.source,
  };
}

/** 列出與某聯絡人相關（作為 survivor 或被合併方）的合併紀錄，新到舊 */
export async function listMergeLogs(db: TenantDb, tenantId: string, contactId: string) {
  return db.contactMergeLog.findMany({
    where: { tenantId, OR: [{ survivorId: contactId }, { mergedId: contactId }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
