'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mutate as globalMutate } from 'swr';
import { ChevronRight, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChannels } from '@/hooks/useChannels';
import type { ShortLink } from '@/hooks/useShortLinks';
import { getApiErrorMessage } from '@/lib/api-error';
import { toLocalInputValue, toIsoForApi } from '@/lib/datetime-local';

const LIST_HREF = '/dashboard/shortlinks/links';

const inputCls =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary disabled:bg-muted disabled:text-muted-foreground';

function Field({ label, htmlFor, required, hint, children }: {
  label: string; htmlFor: string; required?: boolean; hint?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="border-b border-border pb-2.5 text-sm font-semibold text-foreground">{children}</h2>;
}

/** 可收合區塊（UTM、社群預覽）：右側顯示目前狀態，收合時也看得出有沒有填 */
function Collapsible({ title, status, defaultOpen, children }: {
  title: string; status: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center gap-2 bg-muted px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="flex-1 text-[15px] font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </button>
      {open && <div className="flex flex-col gap-4 border-t border-border p-4">{children}</div>}
    </div>
  );
}

function MonoLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="font-mono text-xs text-muted-foreground">{children}</label>;
}

export function LinkForm({ editData }: { editData?: ShortLink | null }) {
  const router = useRouter();
  const isEdit = Boolean(editData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [targetUrl, setTargetUrl] = useState(editData?.targetUrl ?? '');
  const [title, setTitle] = useState(editData?.title ?? '');
  const [slug, setSlug] = useState(editData?.slug ?? '');
  const [utm, setUtm] = useState({
    utmSource: editData?.utmSource ?? '',
    utmMedium: editData?.utmMedium ?? '',
    utmCampaign: editData?.utmCampaign ?? '',
    utmContent: editData?.utmContent ?? '',
    utmTerm: editData?.utmTerm ?? '',
  });
  const [tagOnClick, setTagOnClick] = useState(editData?.tagOnClick ?? '');
  const [expiresAt, setExpiresAt] = useState(toLocalInputValue(editData?.expiresAt));
  const [lineChannelId, setLineChannelId] = useState(editData?.lineChannelId ?? '');
  const [ogTitle, setOgTitle] = useState(editData?.ogTitle ?? '');
  const [ogDescription, setOgDescription] = useState(editData?.ogDescription ?? '');
  const [ogImage, setOgImage] = useState(editData?.ogImage ?? '');
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);

  const { channels } = useChannels();
  const lineChannels = (channels as Array<{ id: string; displayName: string; channelType: string }>).filter(
    (c) => c.channelType === 'LINE',
  );

  useEffect(() => {
    api.get('/tags').then((res) => {
      setTags((res.data.data || []).map((t: Record<string, unknown>) => ({ id: t.id as string, name: t.name as string })));
    }).catch(() => {});
  }, []);

  // 短網址的實際網域：跟列表「複製 URL」用同一個規則
  const shortPrefix = useMemo(() => {
    if (typeof window === 'undefined') return '/s/';
    const origin = window.location.origin.replace(/^http:\/\/localhost:3000$/, 'http://localhost');
    return `${origin.replace(/^https?:\/\//, '')}/s/`;
  }, []);

  const utmCount = Object.values(utm).filter((v) => v.trim()).length;
  const ogFilled = Boolean(ogTitle.trim() || ogDescription.trim() || ogImage.trim());
  const missing = targetUrl.trim() ? [] : ['目標 URL'];
  const canSubmit = missing.length === 0 && !saving;

  const selectedLine = lineChannels.find((c) => c.id === lineChannelId);

  const handleSave = async () => {
    if (!canSubmit) return;
    setError('');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        targetUrl: targetUrl.trim(),
        title: title || undefined,
        utmSource: utm.utmSource || undefined,
        utmMedium: utm.utmMedium || undefined,
        utmCampaign: utm.utmCampaign || undefined,
        utmContent: utm.utmContent || undefined,
        utmTerm: utm.utmTerm || undefined,
        tagOnClick: tagOnClick || undefined,
        // 第二參數 = 可清除：編輯時清空要送 null，否則後端當成「這欄不動」
        expiresAt: toIsoForApi(expiresAt, isEdit),
        lineChannelId: lineChannelId || null,
        ogTitle: ogTitle || undefined,
        ogDescription: ogDescription || undefined,
        ogImage: ogImage || undefined,
      };
      if (!isEdit && slug.trim()) payload.slug = slug.trim();

      if (isEdit) await api.patch(`/shortlinks/${editData!.id}`, payload);
      else await api.post('/shortlinks', payload);

      await globalMutate((key) => typeof key === 'string' && key.startsWith('/shortlinks'));
      router.push(LIST_HREF);
    } catch (err) {
      setError(getApiErrorMessage(err, '儲存失敗，請檢查輸入內容'));
    } finally {
      setSaving(false);
    }
  };

  const pageTitle = isEdit ? '編輯短連結' : '建立短連結';

  return (
    <div className="px-8 pb-10 pt-8">
      <div className="flex max-w-[620px] flex-col gap-6">
        {/* 麵包屑＋標題 */}
        <div className="flex flex-col gap-3">
          <nav aria-label="麵包屑" className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">短連結</span>
            <span className="text-muted-foreground" aria-hidden="true">&gt;</span>
            <Link href={LIST_HREF} className="text-primary hover:text-primary-hover">連結管理</Link>
            <span className="text-muted-foreground" aria-hidden="true">&gt;</span>
            <span className="text-foreground" aria-current="page">{pageTitle}</span>
          </nav>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold leading-8 text-foreground">{pageTitle}</h1>
            <p className="text-sm text-muted-foreground">
              短網址網域 {shortPrefix.replace(/\/s\/$/, '')}，建立後即可於連結管理列表追蹤點擊
            </p>
          </div>
        </div>

        {/* 基本資訊 */}
        <section className="flex flex-col gap-5">
          <SectionTitle>基本資訊</SectionTitle>
          <Field label="目標 URL" htmlFor="sl-target" required>
            <input id="sl-target" className={inputCls} value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/campaign/autumn" aria-required="true" />
          </Field>
          <Field label="標題" htmlFor="sl-title">
            <input id="sl-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="用於辨識這個連結的描述" />
          </Field>
          <Field label="自訂 Slug" htmlFor="sl-slug" hint={isEdit ? '建立後無法修改短網址' : '留空則自動產生短網址'}>
            <div className="flex h-10 overflow-hidden rounded-md border border-border focus-within:border-primary">
              <span className="flex items-center border-r border-border bg-muted px-3 font-mono text-[13px] text-muted-foreground">
                {shortPrefix}
              </span>
              <input id="sl-slug" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={isEdit}
                placeholder="autumn-sale"
                className="min-w-0 flex-1 bg-background px-3 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:bg-muted disabled:text-muted-foreground" />
            </div>
          </Field>
        </section>

        {/* 進階設定 */}
        <section className="flex flex-col gap-5">
          <SectionTitle>進階設定</SectionTitle>

          <Collapsible title="UTM 參數" status={utmCount ? `已設定 ${utmCount} 項` : '未設定'}>
            {([
              ['utmSource', 'utm_source', 'line'],
              ['utmMedium', 'utm_medium', 'social'],
              ['utmCampaign', 'utm_campaign', 'autumn_sale'],
              ['utmContent', 'utm_content', 'banner_a'],
              ['utmTerm', 'utm_term', ''],
            ] as const).map(([key, label, ph]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <MonoLabel htmlFor={`sl-${key}`}>{label}</MonoLabel>
                <input id={`sl-${key}`} className={inputCls} value={utm[key]} placeholder={ph}
                  onChange={(e) => setUtm((u) => ({ ...u, [key]: e.target.value }))} />
              </div>
            ))}
          </Collapsible>

          <Field label="點擊時自動貼標" htmlFor="sl-tag">
            <select id="sl-tag" className={cn(inputCls, 'cursor-pointer')} value={tagOnClick} onChange={(e) => setTagOnClick(e.target.value)}>
              <option value="">不貼標</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>

          <Field label="到期時間" htmlFor="sl-expires" hint="留空表示永不到期">
            <input id="sl-expires" type="datetime-local" className={inputCls} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>

          <Field
            label="LINE 渠道（LIFF 收集身份）"
            htmlFor="sl-line"
            hint={selectedLine
              ? `於 LINE App 內點擊會經「${selectedLine.displayName}」的 LIFF 取得 LINE 身份再背景計數；外部瀏覽器與 Bot 不受影響。`
              : '在 LINE 內或外部瀏覽器點擊皆直接前往目標頁，不收集身份。'}
          >
            <select id="sl-line" className={cn(inputCls, 'cursor-pointer')} value={lineChannelId} onChange={(e) => setLineChannelId(e.target.value)}>
              <option value="">不使用 LIFF</option>
              {lineChannels.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
          </Field>

          <Collapsible title="社群預覽設定" status={ogFilled ? '手動設定' : '自動抓取'} defaultOpen>
            <div className="flex flex-col gap-1.5">
              <MonoLabel htmlFor="sl-og-title">og:title</MonoLabel>
              <input id="sl-og-title" className={inputCls} value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} placeholder="分享到社群時顯示的標題" />
            </div>
            <div className="flex flex-col gap-1.5">
              <MonoLabel htmlFor="sl-og-desc">og:description</MonoLabel>
              <input id="sl-og-desc" className={inputCls} value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} placeholder="一句話描述，約 80 字內" />
            </div>
            <div className="flex flex-col gap-1.5">
              <MonoLabel htmlFor="sl-og-image">og:image URL</MonoLabel>
              <input id="sl-og-image" className={inputCls} value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="https://example.com/og/autumn.jpg" />
            </div>
            <p className="text-xs text-muted-foreground">全部留空時，系統會自動抓取目標頁面的 OG 資訊</p>
          </Collapsible>
        </section>

        {error && (
          <div role="alert" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
            className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <button type="button" onClick={handleSave} disabled={!canSubmit}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-primary/20 disabled:text-primary/50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? '儲存' : '建立'}
          </button>
          <button type="button" onClick={() => router.push(LIST_HREF)}
            className="h-10 rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            取消
          </button>
          {missing.length > 0 && <p className="text-xs text-muted-foreground">尚未完成：{missing.join('、')}</p>}
        </div>
      </div>
    </div>
  );
}
