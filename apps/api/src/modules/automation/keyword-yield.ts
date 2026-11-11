/**
 * AI 回覆是否讓步給關鍵字規則（change outbox-event-delivery，AUDIT ARCH-02：原本放在 automation.worker.ts，
 * kb-autoreply 要 import worker 檔）。放在 automation 模組的 helper 檔，不放進 @open333crm/automation：
 * 這裡要讀資料庫並用 core、channel-plugins，而 apps/web 會打包那個套件。
 *
 * 收呼叫端的 Prisma executor（AGENTS.md 結構規則 2），每個查詢都自帶 tenantId。
 */
import { AUTOMATION_DELIVERY_CHANNEL_TYPES } from '@open333crm/channel-plugins';
import { couponNotPastFixedEnd, logger } from '@open333crm/core';
import {
  buildAutomationFacts,
  evaluateRules,
  matchKeywordTrigger,
  validateAutomationRuleContract,
  type AutomationFactsDb,
} from '@open333crm/automation';

/** hasMatchingKeywordRule 用到的 Prisma model 方法。PrismaClient 與交易 client 都符合 */
export interface KeywordYieldDb extends AutomationFactsDb {
  automationRule: { findMany(args: any): PromiseLike<any[]> };
  material: { findMany(args: any): PromiseLike<Array<{ channelType: string | null }>> };
  coupon: { findMany(args: any): PromiseLike<Array<{ id: string }>> };
}

/** 規則有沒有條件。`{ all: [] }`、`{ any: [] }` 或沒有條件時，json-rules-engine 一律視為成立 */
function hasRuleConditions(conditions: unknown): boolean {
  if (!conditions || typeof conditions !== 'object') return false;
  const { all, any } = conditions as { all?: unknown; any?: unknown };
  return (Array.isArray(all) && all.length > 0) || (Array.isArray(any) && any.length > 0);
}

/**
 * 訊息命中的 active keyword.matched 規則中，有沒有能在這個渠道回覆顧客的動作。
 * agent 與 KB 自動回覆用來決定是否讓步（命中就讓 keyword 規則回，避免一次兩則）。
 * 發送進行中優惠券的規則也算（add-coupon-system design D25）。
 * 只加標籤、或素材是別的渠道的規則不算：workers 不會替它回覆，AI 讓步的話顧客什麼都收不到
 * （change fix-keyword-yield-ig-delivery）。
 * 不通過契約驗證或條件不成立的規則也不算：workers 會略過這種規則（change fix-automation-rule-gaps）。
 * 條件用與 workers 相同的 buildAutomationFacts 評估，對同一則訊息得出相同結果。
 */
export async function hasMatchingKeywordRule(
  prisma: KeywordYieldDb,
  tenantId: string,
  messageText: string,
  channelType: string,
  factContext: { conversationId?: string; contactId?: string } = {},
): Promise<boolean> {
  if (!messageText) return false;
  // workers 送不到的渠道，規則命中也回覆不了顧客
  if (!AUTOMATION_DELIVERY_CHANNEL_TYPES.includes(channelType.toUpperCase())) return false;
  const rules = await prisma.automationRule.findMany({
    where: { tenantId, isActive: true },
  });
  const matchedRules = rules.filter((rule) => matchKeywordTrigger(rule.trigger, messageText) !== null);
  if (matchedRules.length === 0) return false;

  // workers 驗證失敗就整條略過（automation.handler.ts）
  const validRules = matchedRules.filter(
    (rule) =>
      validateAutomationRuleContract({
        eventName: 'keyword.matched',
        conditions: rule.conditions,
        actions: rule.actions,
      }).valid,
  );
  if (validRules.length === 0) return false;

  // 條件不成立時 workers 不執行規則，AI 讓步的話顧客什麼都收不到（問題清單 A09）。
  // 沒有條件的規則一定成立，不必讀條件資料。有條件的規則在無法評估時（沒有對話與聯絡人、
  // 或讀取失敗）視為不成立：寧可 AI 照常回覆，也不要讓顧客收不到回覆（review #282）
  const unconditionalRules = validRules.filter((rule) => !hasRuleConditions(rule.conditions));
  let evaluableRules = validRules;
  let facts: Record<string, unknown> = {};
  if (unconditionalRules.length < validRules.length) {
    if (!factContext.conversationId && !factContext.contactId) {
      logger.warn('[KeywordYield] 沒有對話與聯絡人，有條件的規則無法評估，不讓步', { tenantId });
      evaluableRules = unconditionalRules;
    } else {
      try {
        facts = await buildAutomationFacts(prisma, {
          tenantId,
          conversationId: factContext.conversationId,
          contactId: factContext.contactId,
          messageContent: messageText,
        });
      } catch (err) {
        logger.warn('[KeywordYield] 讀取條件資料失敗，有條件的規則不讓步', { tenantId, err });
        evaluableRules = unconditionalRules;
      }
    }
  }
  if (evaluableRules.length === 0) return false;
  const passed = await evaluateRules(
    evaluableRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      conditions: rule.conditions as any,
      actions: [],
    })),
    facts,
  );
  const passedIds = new Set(passed.map((m) => m.ruleId));
  const firingRules = validRules.filter((rule) => passedIds.has(rule.id));

  const actions = firingRules.flatMap((rule) =>
    Array.isArray(rule.actions) ? (rule.actions as Array<{ type?: string; params?: Record<string, unknown> }>) : [],
  );
  if (actions.some((a) => a.type === 'send_message')) return true;

  // 與 workers 的 send_material 相同：素材渠道與對話渠道不同時不會送出
  const materialIds = actions
    .filter((a) => a.type === 'send_material' && typeof a.params?.materialId === 'string')
    .map((a) => a.params!.materialId as string);
  if (materialIds.length > 0) {
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds }, tenantId },
      select: { channelType: true },
    });
    const target = channelType.toLowerCase();
    if (materials.some((m) => m.channelType?.toLowerCase() === target)) return true;
  }

  // 發券：券是進行中才會送出發券訊息（add-coupon-system design D25）。
  // 券已暫停或結束時 workers 不發券，有填「發不出時回覆顧客」也只是一句說明，AI 照常回覆
  const couponIds = actions
    .filter((a) => a.type === 'issue_coupon' && typeof a.params?.couponId === 'string')
    .map((a) => a.params!.couponId as string);
  if (couponIds.length === 0) return false;
  const activeCoupons = await prisma.coupon.findMany({
    // 固定效期已過到期日的券 workers 不發（isCouponPastFixedEnd），與暫停一樣讓 AI 回覆
    where: { id: { in: couponIds }, tenantId, status: 'ACTIVE', ...couponNotPastFixedEnd(new Date()) },
    select: { id: true },
  });
  return activeCoupons.length > 0;
}

