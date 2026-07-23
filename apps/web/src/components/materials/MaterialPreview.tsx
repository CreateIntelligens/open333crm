'use client';

/**
 * MaterialPreview — 把 rendered body 視覺化。
 *
 * LINE Flex 預覽統一交給 line-flex-message-renderer；其他 LINE / FB 素材仍使用
 * 本地簡易預覽元件。實際發送由 channel plugin 處理。
 */

import React from 'react';
import { Image as ImageIcon, Video as VideoIcon, MapPin, Clock, Phone } from 'lucide-react';
import {
  FlexMessagePreview,
  LineChatFrame,
  type FlexContainer,
} from 'line-flex-message-renderer';

interface Props {
  channelType: string;
  contentType: string;
  body: Record<string, unknown>;
}

export function MaterialPreview({ channelType, contentType, body }: Props) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="mb-3 text-center text-xs text-slate-400">
        {channelType.toUpperCase()} · {contentType}
      </div>
      {/* LINE Flex / FB 卡片在真實裝置只有 ~300px 寬，這層讓內容居中而非撐滿 */}
      <div className="flex justify-center overflow-x-auto">
        <div className="min-w-0">
          <PreviewBody contentType={contentType} body={body} />
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ contentType, body }: { contentType: string; body: Record<string, unknown> }) {
  // LINE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  if (contentType === 'line_text') return <BubbleText text={b.text ?? ''} />;
  if (contentType === 'line_image') return <MediaCard kind="image" url={b.mediaUrl} />;
  if (contentType === 'line_video') return <MediaCard kind="video" url={b.previewImageUrl ?? b.previewUrl} />;
  if (contentType === 'line_carousel') {
    return <LineCarouselPreview body={b} />;
  }
  if (contentType === 'line_imagemap') {
    return <MediaCard kind="image" url={b.baseImageUrl} />;
  }
  if (contentType === 'line_flex_showcase' || contentType === 'line_flex_template') {
    const flex = b.type === 'flex' ? b.contents : b.contents ?? b;
    if (!flex || (flex.type !== 'bubble' && flex.type !== 'carousel')) {
      return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">尚未匯入 Flex JSON</div>;
    }
    return <FlexPreview flex={flex} />;
  }
  // FB
  if (contentType === 'fb_text') return <BubbleText text={b.text ?? ''} />;
  if (contentType === 'fb_image') return <MediaCard kind="image" url={b.url ?? b.mediaUrl} />;
  if (contentType === 'fb_video') return <MediaCard kind="video" url={b.url ?? b.mediaUrl} />;
  if (contentType === 'fb_generic') return <CarouselPreview cards={fbGenericToCards(b)} />;
  if (contentType === 'fb_button') return <ButtonsPreview text={b.text} buttons={fbButtonsToUniversal(b.buttons ?? [])} />;
  if (contentType === 'fb_media') return <MediaCard kind="image" url={b.url} />;
  if (contentType === 'fb_coupon') return <CouponPreview body={b} />;
  if (contentType === 'fb_receipt') return <ReceiptPreview body={b} />;
  if (contentType === 'fb_feedback') return <FeedbackPreview body={b} />;
  return <BubbleText text="（暫無此版型的預覽）" />;
}

// ─── 共用小元件 ─────────────────────────────────────────────────────────

function BubbleText({ text }: { text: string }) {
  return (
    <div className="max-w-xs rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
      {text || <span className="text-slate-400">（空訊息）</span>}
    </div>
  );
}

function MediaCard({ kind, url }: { kind: 'image' | 'video'; url?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="relative flex h-40 items-center justify-center bg-slate-200 text-slate-400">
        {url ? (
          kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <VideoIcon className="absolute h-12 w-12 text-white opacity-80" />
            </>
          )
        ) : kind === 'image' ? (
          <ImageIcon className="h-10 w-10" />
        ) : (
          <VideoIcon className="h-10 w-10" />
        )}
      </div>
    </div>
  );
}

function CardBubble({ card }: { card: { title?: string; subtitle?: string; imageUrl?: string; buttons?: any[] } }) {
  return (
    <div className="mx-auto max-w-xs overflow-hidden rounded-2xl bg-white shadow-sm">
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" className="h-32 w-full object-cover" />
      )}
      <div className="px-4 py-3">
        <div className="text-sm font-bold text-slate-900">{card.title}</div>
        {card.subtitle && <div className="mt-1 text-xs text-slate-500">{card.subtitle}</div>}
      </div>
      {card.buttons && card.buttons.length > 0 && (
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {card.buttons.map((btn: any, idx: number) => (
            <div key={idx} className="px-4 py-2 text-center text-sm font-medium text-blue-600">
              {btn.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CarouselPreview({ cards }: { cards: any[] }) {
  return (
    <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
      {cards.map((card, idx) => (
        <div key={idx} className="w-56 flex-shrink-0">
          <CardBubble card={card} />
        </div>
      ))}
    </div>
  );
}

function ButtonsPreview({ text, buttons }: { text?: string; buttons: any[] }) {
  return (
    <div className="mx-auto max-w-xs overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="px-4 py-3 text-sm text-slate-800">{text}</div>
      <div className="divide-y divide-slate-200 border-t border-slate-200">
        {buttons.map((btn: any, idx: number) => (
          <div key={idx} className="px-4 py-2 text-center text-sm font-medium text-blue-600">
            {btn.label ?? btn.title}
          </div>
        ))}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function FlexPreview({ flex }: { flex: any }) {
  if (!flex || (flex.type !== 'bubble' && flex.type !== 'carousel')) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">
        Flex JSON 格式不支援預覽
      </div>
    );
  }

  return (
    <LineChatFrame accountName="LINE" width={340}>
      <FlexMessagePreview json={flex as FlexContainer} />
    </LineChatFrame>
  );
}

// ─── FB Coupon / Receipt / Feedback 簡易預覽 ─────────────────────────

function CouponPreview({ body }: { body: any }) {
  return (
    <div className="mx-auto max-w-xs space-y-2">
      {body.coupon_pre_message && <BubbleText text={body.coupon_pre_message} />}
      <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-gradient-to-br from-amber-100 to-amber-200 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-700">Coupon</div>
        <div className="mt-1 text-lg font-bold text-amber-900">{body.title}</div>
        {body.subtitle && <div className="mt-1 text-xs text-amber-800">{body.subtitle}</div>}
        <div className="mt-3 inline-block rounded-md border border-amber-500 bg-white px-5 py-2 text-sm font-semibold text-amber-800">
          Reveal code
        </div>
        <div className="mt-2 text-[10px] text-amber-700">Terms may apply.</div>
      </div>
    </div>
  );
}

function ReceiptPreview({ body }: { body: any }) {
  return (
    <div className="mx-auto max-w-xs overflow-hidden rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-emerald-600">RECEIPT</div>
      <div className="mt-1 text-xl font-bold">{body.merchant_name ?? 'Merchant'}</div>
      <div className="mt-2 text-xs text-slate-500">
        收件人：{body.recipient_name}<br />
        訂單編號：{body.order_number}<br />
        付款：{body.payment_method}
      </div>
      <div className="my-3 border-t border-slate-200" />
      <div className="flex justify-between text-sm">
        <span>TOTAL</span>
        <span className="font-bold">
          {body.currency ?? 'TWD'} {body.summary?.total_cost ?? 0}
        </span>
      </div>
    </div>
  );
}

function FeedbackPreview({ body }: { body: any }) {
  const opts = body?.feedback_screens?.[0]?.options ?? ['1', '2', '3', '4', '5'];
  return (
    <div className="mx-auto max-w-xs rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold">{body.title ?? '滿意度調查'}</div>
      {body.subtitle && <div className="mt-1 text-xs text-slate-500">{body.subtitle}</div>}
      <div className="mt-3 flex justify-between">
        {opts.map((o: string, idx: number) => (
          <div key={idx} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm">
            {o}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LINE 多頁訊息（line_carousel）預覽 ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LineCarouselPreview({ body }: { body: any }) {
  const pageType: 'product' | 'location' | 'person' | 'image_text' = body?.pageType ?? 'product';
  const pages: any[] = body?.pages ?? [];
  const endPage = body?.endPage;

  if (pages.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">尚未新增頁面</div>;
  }

  return (
    <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
      {pages.map((page, idx) => (
        <div key={idx} className="w-56 flex-shrink-0">
          <CarouselPageCard pageType={pageType} page={page} />
        </div>
      ))}
      {endPage && (
        <div className="w-56 flex-shrink-0">
          <EndPageCard endPage={endPage} />
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CarouselPageCard({ pageType, page }: { pageType: 'product' | 'location' | 'person' | 'image_text'; page: any }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {/* hero 圖 — 沒填時用灰色 placeholder + 大寫 A */}
      <div className="relative aspect-square w-full bg-[#7B9BAA]">
        {page.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-7xl font-bold text-white/60">A</div>
        )}
        {/* 標籤（非人物 pageType） */}
        {pageType !== 'person' && (
          <div
            className="absolute left-3 top-3 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              backgroundColor: page.label?.bgColor ?? '#9CA3AF',
              color: page.label?.bgColor === '#ffffff' ? '#27272a' : '#ffffff',
            }}
          >
            {page.label?.text || '輸入標籤文字'}
          </div>
        )}
        {/* 人物 pageType：標籤覆蓋圖 */}
        {pageType === 'person' && (
          <div
            className="absolute left-3 top-3 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#9CA3AF', color: '#ffffff' }}
          >
            輸入人物特點
          </div>
        )}
      </div>

      <div className="space-y-1.5 px-4 py-3">
        {/* 人物：姓名 */}
        {pageType === 'person' && (
          <div className="text-base font-bold text-slate-900">
            {page.name || <span className="text-slate-400 font-normal">輸入姓名</span>}
          </div>
        )}

        {/* 人物：特點 1-3（覆蓋上方標籤位置之外，這裡顯示為標籤行） */}
        {pageType === 'person' && Array.isArray(page.tags) && page.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-0.5">
            {page.tags.map((tag: { text: string; color: string }, i: number) => (
              <span
                key={i}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: tag.color ?? '#9CA3AF', color: tag.color === '#ffffff' ? '#27272a' : '#ffffff' }}
              >
                {tag.text || '輸入特點'}
              </span>
            ))}
          </div>
        )}

        {/* 標題（非人物） */}
        {pageType !== 'person' && (
          <div className="text-base font-bold text-slate-900 line-clamp-2">
            {page.title || <span className="text-slate-400 font-normal">輸入標題</span>}
          </div>
        )}

        {/* 文字說明（地點 / 商品 / 圖文 / 人物） */}
        <div className="text-[13px] text-slate-500 line-clamp-2">
          {page.description || <span className="text-slate-400">輸入文字說明</span>}
        </div>

        {/* 地點：地址 */}
        {pageType === 'location' && (
          <div className="flex items-start gap-1.5 pt-0.5 text-[12px] text-slate-700">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-2">{page.address || <span className="text-slate-400">輸入地址</span>}</span>
          </div>
        )}

        {/* 地點：相關資訊 */}
        {pageType === 'location' && page.extraInfo && (
          <div className="flex items-center gap-1.5 text-[12px] text-slate-700">
            {page.extraInfo.type === '時間' && <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            {page.extraInfo.type === '電話' && <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            {page.extraInfo.type !== '時間' && page.extraInfo.type !== '電話' && <span className="text-[10px] text-slate-400 shrink-0">{page.extraInfo.type}</span>}
            <span>{page.extraInfo.value || <span className="text-slate-400">輸入資訊</span>}</span>
          </div>
        )}

        {/* 商品：價格 */}
        {pageType === 'product' && (
          <div className="pt-1 text-right text-base font-bold text-slate-900">
            {page.price?.amount
              ? `${page.price.currency ?? 'NT$'} ${page.price.amount}`
              : <span className="text-slate-400 font-normal">NT $00,000</span>}
          </div>
        )}
      </div>

      {/* 動作按鈕 1 / 2（藍色文字、靠左） */}
      <div className="space-y-1 border-t border-slate-100 px-4 py-2.5">
        <ActionRow action={page.action1} fallback="輸入動作標籤的說明" />
        {page.action2 && <ActionRow action={page.action2} fallback="輸入動作標籤的說明" />}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActionRow({ action, fallback }: { action: any; fallback: string }) {
  const label = action?.label?.trim();
  return (
    <div className="text-sm font-medium text-blue-600">
      {label || <span className="text-blue-400">{fallback}</span>}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EndPageCard({ endPage }: { endPage: any }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="relative h-32 w-full bg-slate-100">
        {endPage.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={endPage.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-slate-300" />
          </div>
        )}
      </div>
      <div className="px-4 py-3 text-center">
        <div className="text-xs text-slate-400">結尾頁</div>
        <div className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">
          {endPage.label || endPage.action?.label || '了解更多'}
        </div>
      </div>
    </div>
  );
}

// ─── 工具 ──────────────────────────────────────────────────────────────

function fbGenericToCards(body: any) {
  return (body.elements ?? []).map((el: any) => ({
    title: el.title,
    subtitle: el.subtitle,
    imageUrl: el.image_url,
    buttons: (el.buttons ?? []).map((b: any) => ({ label: b.title })),
  }));
}

function fbButtonsToUniversal(buttons: any[]) {
  return buttons.map((b: any) => ({ label: b.title }));
}
