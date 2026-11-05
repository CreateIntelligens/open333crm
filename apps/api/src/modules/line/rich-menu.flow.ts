/**
 * 圖文選單的 flow。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 * CRUD 每個操作只呼叫一個 service 函式，所以用 flowOf。
 * 發布要呼叫 LINE，拆成「交易：認領 → 交易外：LINE → 交易：寫入結果」（change migrate-line-tenant-ctx design D1～D4）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import { AppError } from '../../shared/utils/response.js';
import {
  cancelLineDefaultRichMenu,
  createLineRichMenu,
  deleteLineRichMenu,
  fetchRichMenuImage,
  getLineDefaultRichMenuId,
  setLineDefaultRichMenu,
  uploadLineRichMenuImage,
} from './rich-menu.line-api.js';
import {
  claimRichMenuForPublish,
  completeRichMenuPublish,
  completeRichMenuUnpublish,
  prepareRichMenuBindJob,
  readRichMenuForUnpublish,
  RICH_MENU_BIND_JOB_OPTIONS,
  RICH_MENU_BIND_QUEUE,
  type RichMenuAudience,
  releaseRichMenuPublish,
  createRichMenu,
  deleteRichMenu,
  duplicateRichMenu,
  getRichMenu,
  listRichMenus,
  updateRichMenu,
} from './rich-menu.service.js';

export const listRichMenusFlow = flowOf(listRichMenus);
export const getRichMenuFlow = flowOf(getRichMenu);
export const createRichMenuFlow = flowOf(createRichMenu);
export const updateRichMenuFlow = flowOf(updateRichMenu);
export const deleteRichMenuFlow = flowOf(deleteRichMenu);
export const duplicateRichMenuFlow = flowOf(duplicateRichMenu);


export const DEFAULT_NOT_SET = 'DEFAULT_NOT_SET';

/**
 * 發布：LINE 上最多建立一次選單。LINE 建好之後任何一步失敗，刪除剛建立的選單並標成 error（design D2）。
 * 設預設失敗時 LINE 上原本的預設不受影響，這個選單記成非預設，回應帶 DEFAULT_NOT_SET（design D4）。
 */
export async function publishRichMenuFlow(deps: { prisma: PrismaClient }, tenantId: string, id: string) {
  const claim = await inTenant(deps.prisma, tenantId, (scope) => claimRichMenuForPublish(scope, id));
  const { menu, accessToken, claimedAt } = claim;

  let image;
  try {
    image = await fetchRichMenuImage(menu.imageUrl);
  } catch (err) {
    // 還沒呼叫 LINE：回到發布前的狀態（中斷後重新發布的選單沒有可回去的狀態，記成 error）
    await release(deps, tenantId, id, claimedAt, menu.status === 'draft' ? 'draft' : 'error');
    throw err;
  }

  let lineRichMenuId: string | null = null;
  let defaultSet = false;
  try {
    lineRichMenuId = await createLineRichMenu(accessToken, {
      size: menu.size,
      selected: menu.selected,
      name: menu.name,
      chatBarText: menu.chatBarText,
      areas: menu.areas,
    });
    await uploadLineRichMenuImage(accessToken, lineRichMenuId, image);
    if (menu.isDefault) {
      defaultSet = await setLineDefaultRichMenu(accessToken, lineRichMenuId);
      if (!defaultSet) logger.warn(`[RichMenu] set default failed id=${id} lineRichMenuId=${lineRichMenuId}`);
    }

    const created = lineRichMenuId;
    const published = await inTenant(deps.prisma, tenantId, (scope) =>
      completeRichMenuPublish(scope, id, claimedAt, { lineRichMenuId: created, isDefault: defaultSet }),
    );
    if (!published) {
      throw new AppError('發布逾時，這個圖文選單已被重新發布，請重新整理後確認', 'PUBLISH_IN_PROGRESS', 409);
    }
    logger.info(`[RichMenu] published id=${id} lineRichMenuId=${lineRichMenuId}`);
    return { ...published, warnings: menu.isDefault && !defaultSet ? [DEFAULT_NOT_SET] : [] };
  } catch (err) {
    if (lineRichMenuId) {
      await compensate(accessToken, id, lineRichMenuId, defaultSet ? claim.previousDefaultLineId : undefined);
    }
    await release(deps, tenantId, id, claimedAt, 'error');
    throw err;
  }
}

/**
 * 刪除剛建立的 LINE 選單。設預設已成功時，先把預設設回舊選單，避免所有好友失去預設。
 * 失敗只記 log（LINE 端的 id 供對帳使用），不蓋掉原本的錯誤。
 */
async function compensate(
  accessToken: string,
  id: string,
  lineRichMenuId: string,
  restoreDefaultLineId: string | null | undefined,
) {
  if (restoreDefaultLineId && !(await setLineDefaultRichMenu(accessToken, restoreDefaultLineId))) {
    logger.error(`[RichMenu] restore default failed id=${id} previousLineRichMenuId=${restoreDefaultLineId}`);
  }
  try {
    await deleteLineRichMenu(accessToken, lineRichMenuId);
  } catch (err) {
    logger.error(`[RichMenu] orphaned LINE rich menu id=${id} lineRichMenuId=${lineRichMenuId}: ${(err as Error).message}`);
  }
}

/** 放掉這次的認領。失敗時選單停在 publishing，5 分鐘後可以重新發布（design D3），所以只記 log */
async function release(deps: { prisma: PrismaClient }, tenantId: string, id: string, claimedAt: Date, status: 'draft' | 'error') {
  try {
    await inTenant(deps.prisma, tenantId, (scope) => releaseRichMenuPublish(scope, id, claimedAt, status));
  } catch (err) {
    logger.error(`[RichMenu] release publish claim failed id=${id}: ${(err as Error).message}`);
  }
}


/**
 * 取消發布：交易外刪除 LINE 選單，再以條件更新寫回 draft（design D5）。
 * 預設選單只在 LINE 目前的預設就是它時才取消預設，不取消別的選單的預設（做法同 line-oa-laravel 的下架）。
 * 兩個取消發布同時執行時，第二次刪除 LINE 回 404、寫回的條件不成立，結果相同，所以不需要認領。
 */
export async function unpublishRichMenuFlow(deps: { prisma: PrismaClient }, tenantId: string, id: string) {
  const { menu, accessToken } = await inTenant(deps.prisma, tenantId, (scope) => readRichMenuForUnpublish(scope, id));

  if (menu.lineRichMenuId) {
    if (menu.isDefault && (await getLineDefaultRichMenuId(accessToken)) === menu.lineRichMenuId) {
      // 取消失敗不擋：刪除選單後 LINE 也不再有指向它的預設
      await cancelLineDefaultRichMenu(accessToken).catch((err: Error) =>
        logger.warn(`[RichMenu] cancel default failed during unpublish id=${id}: ${err.message}`),
      );
    }
    await deleteLineRichMenu(accessToken, menu.lineRichMenuId);
  }

  const updated = await inTenant(deps.prisma, tenantId, (scope) =>
    completeRichMenuUnpublish(scope, id, menu.lineRichMenuId),
  );
  logger.info(`[RichMenu] unpublished id=${id}`);
  return updated;
}


export interface RichMenuBindDeps {
  prisma: PrismaClient;
  events?: EventPublisher;
}

/**
 * 分眾綁定與解除綁定：工作在交易內寫進 outbox，commit 之後送出，至少一次（design D6）。
 * Redis 暫時無法使用時請求仍回成功，由 outbox-relay 補送。
 */
function audienceBindFlow(op: 'link' | 'unlink', jobName: 'bind' | 'unbind') {
  return (deps: RichMenuBindDeps, tenantId: string, id: string, audience: RichMenuAudience) => {
    const events = deps.events ?? createOutboxPublisher(deps.prisma);
    return inTenant(deps.prisma, tenantId, async (scope) => {
      const job = await prepareRichMenuBindJob(scope, id, audience, op);
      if (!job) return { queued: 0 };
      await enqueueJob(scope, events, RICH_MENU_BIND_QUEUE, jobName, job, RICH_MENU_BIND_JOB_OPTIONS);
      logger.info(`[RichMenu] queued ${jobName} menu=${id} users=${job.uids.length}`);
      return { queued: job.uids.length };
    });
  };
}

export const bindRichMenuAudienceFlow = audienceBindFlow('link', 'bind');
export const unbindRichMenuAudienceFlow = audienceBindFlow('unlink', 'unbind');
