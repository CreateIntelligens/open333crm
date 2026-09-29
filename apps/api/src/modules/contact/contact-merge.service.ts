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

export type MergeSource = 'MANUAL' | 'SUGGESTION' | 'LINE_LOGIN' | 'FB_LOGIN' | 'BINDING_CODE';

/** 單次合併搬移的紀錄（存於 ContactMergeLog.movedRecords） */
export interface MovedRecords {
  channelIdentity: string[];
  conversation: string[];
  case: string[];
  longTermMemory: string[];
  portalSubmission: string[];
  pointTransaction: string[];
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
}

export interface MergeContactsInput {
  tenantId: string;
  survivorId: string;
  mergedId: string;
  source: MergeSource;
  actorAgentId?: string;
}

export interface MergeContactsResult {
  mergeLogId: string;
  survivor: { id: string; displayName: string };
  merged: { id: string; displayName: string };
  moved: MovedRecords;
}

/** 撤銷時要搬回的表（tag／屬性不回收，見 design D8） */
type RevertibleKey =
  | 'channelIdentity'
  | 'conversation'
  | 'case'
  | 'portalSubmission'
  | 'pointTransaction'
  | 'identityMap';

async function moveIds(
  find: () => Promise<Array<{ id: string }>>,
  update: (ids: string[]) => Promise<unknown>,
): Promise<string[]> {
  const ids = (await find()).map((r) => r.id);
  if (ids.length > 0) await update(ids);
  return ids;
}

/**
 * 將 mergedId 合併進 survivorId。
 *
 * @param db 呼叫端交易內的 Prisma 執行器
 * @returns 合併紀錄 id、雙方名稱與搬移明細
 */
export async function mergeContacts(db: TenantDb, input: MergeContactsInput): Promise<MergeContactsResult> {
  const { tenantId, survivorId, mergedId, source, actorAgentId } = input;

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
  const pointTransaction = await moveIds(
    () => db.pointTransaction.findMany({ where: { tenantId, contactId: mergedId }, select: { id: true } }),
    (ids) => db.pointTransaction.updateMany({ where: { tenantId, id: { in: ids } }, data: to }),
  );
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
  for (const rel of relations) {
    const fromContactId = rel.fromContactId === mergedId ? survivorId : rel.fromContactId;
    const toContactId = rel.toContactId === mergedId ? survivorId : rel.toContactId;
    const duplicate =
      fromContactId === toContactId ||
      (await db.contactRelation.findFirst({
        where: { fromContactId, toContactId, relationType: rel.relationType, NOT: { id: rel.id } },
        select: { id: true },
      }));
    if (duplicate) {
      await db.contactRelation.delete({ where: { id: rel.id } });
    } else {
      await db.contactRelation.update({ where: { id: rel.id }, data: { fromContactId, toContactId } });
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
  // 先前併入 merged 的聯絡人改指 survivor，讓 mergedIntoId 不形成長鏈
  await db.contact.updateMany({ where: { tenantId, mergedIntoId: mergedId }, data: { mergedIntoId: survivorId } });

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
  await db.contact.update({
    where: { id: mergedId, tenantId },
    data: { isArchived: true, mergedIntoId: survivorId },
  });

  const moved: MovedRecords = {
    channelIdentity,
    conversation,
    case: cases,
    longTermMemory,
    portalSubmission,
    pointTransaction,
    identityMap,
    clickLog,
    flowExecution,
    kbArticleFeedback,
    broadcastRecipient,
    contactTag,
    contactAttribute,
    filledFields,
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

  // survivor 之後可能又被併入別人：沿 mergedIntoId 找出目前持有資料的聯絡人鏈
  const holderChain = [log.survivorId];
  let cursor = log.survivorId;
  for (let i = 0; i < 20; i++) {
    const c = await db.contact.findFirst({ where: { id: cursor, tenantId }, select: { mergedIntoId: true } });
    if (!c?.mergedIntoId || holderChain.includes(c.mergedIntoId)) break;
    cursor = c.mergedIntoId;
    holderChain.push(cursor);
  }

  const moved = log.movedRecords as unknown as Partial<MovedRecords>;
  const back = { contactId: log.mergedId };
  const heldBy = { in: holderChain };
  const ids = (key: RevertibleKey) => moved[key] ?? [];

  if (ids('channelIdentity').length > 0) {
    await db.channelIdentity.updateMany({ where: { id: { in: ids('channelIdentity') }, contactId: heldBy }, data: back });
  }
  if (ids('conversation').length > 0) {
    await db.conversation.updateMany({
      where: { tenantId, id: { in: ids('conversation') }, contactId: heldBy },
      data: back,
    });
  }
  if (ids('case').length > 0) {
    await db.case.updateMany({ where: { tenantId, id: { in: ids('case') }, contactId: heldBy }, data: back });
  }
  if (ids('portalSubmission').length > 0) {
    await db.portalSubmission.updateMany({
      where: { tenantId, id: { in: ids('portalSubmission') }, contactId: heldBy },
      data: back,
    });
  }
  if (ids('pointTransaction').length > 0) {
    await db.pointTransaction.updateMany({
      where: { tenantId, id: { in: ids('pointTransaction') }, contactId: heldBy },
      data: back,
    });
  }
  if (ids('identityMap').length > 0) {
    await db.identityMap.updateMany({
      where: { tenantId, id: { in: ids('identityMap') }, contactId: heldBy },
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

  await db.contact.update({
    where: { id: log.mergedId, tenantId },
    data: { isArchived: false, mergedIntoId: null },
  });
  await db.contactMergeLog.update({
    where: { id: log.id, tenantId },
    data: { revertedAt: new Date(), revertedBy },
  });

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
