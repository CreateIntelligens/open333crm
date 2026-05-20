'use client';

/**
 * MaterialPreview — 把 rendered body 視覺化（LINE Flex / FB Generic / 基礎類型皆覆蓋）
 *
 * 注意：這是「示意預覽」非實際 LINE / FB 渲染引擎。複雜結構（Flex 嵌套 box）
 * 簡化呈現 hero / title / subtitle / footer。實際發送由 channel plugin 處理。
 */

import React from 'react';
import { Image as ImageIcon, Video as VideoIcon, MapPin, Clock, Phone } from 'lucide-react';

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
  if (contentType === 'line_flex_showcase') {
    if (!b.contents) {
      return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">尚未選擇範本</div>;
    }
    return <FlexPreview flex={b.contents} />;
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

// ─── Flex 預覽（對齊 LINE Flex spec） ──────────────────────────────────
//
// 涵蓋規格：
//   bubble / carousel
//   box (vertical / horizontal / baseline) + spacing / margin / padding
//   text size (xxs/xs/sm/md/lg/xl/xxl/3xl/4xl/5xl)、weight、color、wrap、decoration、align
//   image url / aspectRatio / aspectMode (cover/fit) / size
//   icon url / size（與 baseline 對齊）
//   button style (primary/secondary/link) / color / action.label
//   separator
//   filler
//   span（inline 文字片段）
//   absolute position（offsetTop/Start/End/Bottom）
//   backgroundColor / cornerRadius / borderColor / borderWidth
//
// 預覽寬度固定 260px（接近真實 LINE 渲染寬度），不要被父容器壓扁。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function FlexPreview({ flex }: { flex: any }) {
  if (flex?.type === 'carousel') {
    return (
      <div className="flex gap-2 pb-2">
        {(flex.contents ?? []).map((b: unknown, idx: number) => (
          <FlexBubble key={idx} bubble={b} />
        ))}
      </div>
    );
  }
  return <FlexBubble bubble={flex} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexBubble({ bubble }: { bubble: any }) {
  if (!bubble) return null;
  const size = (bubble.size as string) ?? 'mega';
  // 對齊 LINE Flex 真實 bubble 寬度
  const widthMap: Record<string, number> = { nano: 120, micro: 160, deca: 200, hecto: 241, kilo: 260, mega: 300, giga: 386 };
  const width = widthMap[size] ?? 300;

  return (
    <div
      className="overflow-hidden bg-white text-[14px] leading-snug text-[#444] flex-shrink-0"
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        borderRadius: 13,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {bubble.header && <FlexBox box={bubble.header} role="header" parentLayout="vertical" defaultPadding="20px" />}
      {bubble.hero && <FlexHero hero={bubble.hero} />}
      {bubble.body && <FlexBox box={bubble.body} role="body" parentLayout="vertical" defaultPadding="20px" />}
      {bubble.footer && <FlexBox box={bubble.footer} role="footer" parentLayout="vertical" defaultPadding="20px" defaultSpacing="sm" />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexHero({ hero }: { hero: any }) {
  if (hero.type === 'image') return <FlexImageEl image={hero} parentLayout="vertical" />;
  if (hero.type === 'box') return <FlexBox box={hero} role="hero" />;
  return null;
}

// ─── box 容器 ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexBox({ box, role, parentLayout, defaultPadding, defaultSpacing }: { box: any; role?: string; parentLayout?: string; defaultPadding?: string; defaultSpacing?: string }) {
  const layout = (box.layout as string) ?? 'vertical';
  const isPositioned = box.position === 'absolute';
  const isInHorizontalParent = parentLayout === 'horizontal' || parentLayout === 'baseline';

  // box.flex 預設值：水平/baseline parent 為 1，垂直 parent 為 0
  const flexValue: number | undefined =
    typeof box.flex === 'number'
      ? box.flex
      : isInHorizontalParent
        ? 1
        : 0;

  // padding 邏輯：paddingAll 是全部、paddingTop/Bottom/Start/End 是個別覆蓋
  const padAll = cssLen(box.paddingAll) ?? defaultPadding;
  const padTop = cssLen(box.paddingTop) ?? padAll;
  const padBottom = cssLen(box.paddingBottom) ?? padAll;
  const padLeft = cssLen(box.paddingStart) ?? padAll;
  const padRight = cssLen(box.paddingEnd) ?? padAll;

  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'horizontal' || layout === 'baseline' ? 'row' : 'column',
    alignItems: layout === 'baseline' ? 'baseline' : undefined,
    backgroundColor: box.backgroundColor,
    borderRadius: cssLen(box.cornerRadius),
    borderWidth: cssLen(box.borderWidth),
    borderStyle: box.borderWidth ? 'solid' : undefined,
    borderColor: box.borderColor,
    paddingTop: padTop,
    paddingBottom: padBottom,
    paddingLeft: padLeft,
    paddingRight: padRight,
    gap: spacingPx(box.spacing ?? defaultSpacing),
    width: cssLen(box.width),
    height: cssLen(box.height),
    justifyContent: box.justifyContent,
    flexGrow: isPositioned ? undefined : flexValue,
    flexShrink: 1,
    flexBasis: isPositioned ? undefined : (flexValue === 0 ? 'auto' : 0),
    minWidth: 0,
    // box.margin 是相對 sibling 的距離（依 parent layout 方向）
    marginTop: !isPositioned && parentLayout !== 'horizontal' && parentLayout !== 'baseline' ? marginPx(box.margin) : undefined,
    marginLeft: !isPositioned && (parentLayout === 'horizontal' || parentLayout === 'baseline') ? marginPx(box.margin) : undefined,
    position: isPositioned ? 'absolute' : (role === 'hero' || role === 'header' || role === 'body' || role === 'footer' ? 'relative' : undefined),
    top: isPositioned ? cssLen(box.offsetTop) : undefined,
    bottom: isPositioned ? cssLen(box.offsetBottom) : undefined,
    left: isPositioned ? cssLen(box.offsetStart) : undefined,
    right: isPositioned ? cssLen(box.offsetEnd) : undefined,
    overflow: box.cornerRadius ? 'hidden' : undefined,
  };

  return (
    <div style={style}>
      {(box.contents ?? []).map((c: unknown, i: number) => (
        <FlexNode key={i} node={c} parentLayout={layout} />
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexNode({ node, parentLayout }: { node: any; parentLayout: string }) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'box') return <FlexBox box={node} parentLayout={parentLayout} />;
  if (node.type === 'text') return <FlexText text={node} parentLayout={parentLayout} />;
  if (node.type === 'image') return <FlexImageEl image={node} parentLayout={parentLayout} />;
  if (node.type === 'icon') return <FlexIconEl icon={node} />;
  if (node.type === 'button') return <FlexButtonEl button={node} />;
  if (node.type === 'separator') return <FlexSeparator separator={node} parentLayout={parentLayout} />;
  if (node.type === 'filler') return <div style={{ flex: 1 }} />;
  if (node.type === 'span') return <FlexSpan span={node} />;
  return null;
}

// ─── text ─────────────────────────────────────

const TEXT_SIZE: Record<string, number> = {
  xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 27, '3xl': 33, '4xl': 40, '5xl': 48,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexText({ text, parentLayout }: { text: any; parentLayout: string }) {
  // LINE Flex 規範：
  //   horizontal / baseline box 內，子元件未指定 flex 時預設 1
  //   vertical box 內，子元件未指定 flex 時預設 0（佔自身內容寬度）
  //
  // text 元件特殊：horizontal/baseline 內若沒指定 flex，預設 1，但會被內容自動 sizing
  const flexValue: number | undefined =
    typeof text.flex === 'number'
      ? text.flex
      : parentLayout === 'baseline' || parentLayout === 'horizontal'
        ? 1
        : 0;

  const style: React.CSSProperties = {
    fontSize: TEXT_SIZE[text.size as string] ?? 14,
    fontWeight: text.weight === 'bold' ? 700 : 400,
    fontStyle: text.style === 'italic' ? 'italic' : undefined,
    color: text.color ?? '#444',
    textAlign: text.align as React.CSSProperties['textAlign'],
    textDecoration: text.decoration === 'line-through' ? 'line-through' : text.decoration === 'underline' ? 'underline' : undefined,
    flexGrow: flexValue,
    flexShrink: 1,
    flexBasis: flexValue === 0 ? 'auto' : 0,
    marginTop: parentLayout === 'vertical' ? marginPx(text.margin) : undefined,
    marginLeft: parentLayout === 'horizontal' || parentLayout === 'baseline' ? marginPx(text.margin) : undefined,
    whiteSpace: text.wrap ? 'normal' : 'nowrap',
    overflow: text.wrap ? undefined : 'hidden',
    textOverflow: text.wrap ? undefined : 'ellipsis',
    wordBreak: text.wrap ? 'break-word' : undefined,
    lineHeight: 1.4,
    minWidth: 0,
  };

  // 若 contents 是 span 陣列就 render span 們，否則用 text 屬性
  if (Array.isArray(text.contents) && text.contents.length > 0) {
    return (
      <div style={style}>
        {text.contents.map((s: unknown, i: number) => (
          <FlexSpan key={i} span={s} />
        ))}
      </div>
    );
  }
  return <div style={style}>{text.text ?? ''}</div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexSpan({ span }: { span: any }) {
  const style: React.CSSProperties = {
    fontSize: TEXT_SIZE[span.size as string],
    fontWeight: span.weight === 'bold' ? 700 : undefined,
    color: span.color,
    textDecoration: span.decoration === 'line-through' ? 'line-through' : undefined,
  };
  return <span style={style}>{span.text ?? ''}</span>;
}

// ─── image / icon ─────────────────────────

const IMAGE_SIZE: Record<string, string> = {
  xxs: '40px', xs: '60px', sm: '80px', md: '100px', lg: '120px', xl: '140px', xxl: '160px',
  '3xl': '180px', '4xl': '200px', '5xl': '220px', full: '100%',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexImageEl({ image, parentLayout }: { image: any; parentLayout: string }) {
  const aspectMode = image.aspectMode ?? 'fit';
  const aspectRatio = image.aspectRatio ?? '1:1';
  const [w, h] = String(aspectRatio).split(':').map(Number);
  const size = IMAGE_SIZE[image.size as string] ?? IMAGE_SIZE.md;

  const style: React.CSSProperties = {
    width: size,
    aspectRatio: `${w}/${h}`,
    objectFit: aspectMode === 'cover' ? 'cover' : 'contain',
    backgroundColor: image.backgroundColor ?? '#f0f0f0',
    display: 'block',
    flex: typeof image.flex === 'number' ? image.flex : (parentLayout === 'horizontal' ? 1 : undefined),
  };

  // 若沒 URL，顯示 placeholder 而非破圖
  if (!image.url) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1' }}>
        <ImageIcon className="h-8 w-8" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt=""
      style={style}
      onError={(e) => {
        e.currentTarget.style.opacity = '0.3';
      }}
    />
  );
}

const ICON_SIZE: Record<string, number> = {
  xxs: 10, xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 22, '3xl': 24, '4xl': 28, '5xl': 32,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexIconEl({ icon }: { icon: any }) {
  const size = ICON_SIZE[icon.size as string] ?? 14;
  if (!icon.url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon.url}
      alt=""
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        flexGrow: 0,
        display: 'inline-block',
        verticalAlign: 'middle',
        marginLeft: marginPx(icon.margin),
      }}
    />
  );
}

// ─── button ──────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexButtonEl({ button }: { button: any }) {
  const style = (button.style as string) ?? 'link';
  const color = button.color as string | undefined;
  const action = button.action ?? {};
  const height = button.height === 'sm' ? 40 : 52;

  let bg = 'transparent';
  let text = color ?? '#42659a';
  let border = 'none';
  if (style === 'primary') {
    bg = color ?? '#17c950';
    text = '#ffffff';
  } else if (style === 'secondary') {
    bg = color ?? '#dcdfe5';
    text = '#111';
  }
  // link style 文字色用 color，否則用預設藍
  if (style === 'link' && color) text = color;

  const btnStyle: React.CSSProperties = {
    height,
    background: bg,
    color: text,
    border,
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    marginTop: marginPx(button.margin),
    flex: typeof button.flex === 'number' ? button.flex : undefined,
  };

  return <div style={btnStyle}>{action.label ?? ''}</div>;
}

// ─── separator ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlexSeparator({ separator, parentLayout }: { separator: any; parentLayout: string }) {
  if (parentLayout === 'horizontal' || parentLayout === 'baseline') {
    return <div style={{ width: 1, alignSelf: 'stretch', backgroundColor: separator.color ?? '#dcdfe5', marginLeft: marginPx(separator.margin) }} />;
  }
  return <div style={{ height: 1, width: '100%', backgroundColor: separator.color ?? '#dcdfe5', marginTop: marginPx(separator.margin) }} />;
}

// ─── 工具 ─────────────────────────

const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
function spacingPx(s?: string): number | undefined {
  if (!s) return undefined;
  return SPACING[s] ?? undefined;
}
function marginPx(m?: string): number | undefined {
  if (!m) return undefined;
  return SPACING[m] ?? undefined;
}
function cssLen(v?: string): string | undefined {
  if (!v) return undefined;
  return v;
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
