'use client';

/**
 * 領券連結分頁（add-coupon-system A15 15.32；design D30）。
 *
 * 公開領券的網址與 QR Code：放在海報、官網、圖文選單上，顧客開啟後到指定渠道傳送領券訊息就會收到券。
 * 一張行銷券可建立多個連結（各自的名稱方便分辨投放位置），看得到每個連結的開啟數與領取數。
 * 客服補償券不能公開領取，只顯示說明。
 */
import React, { useState } from 'react';
import { Copy, Download, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Coupon } from '@/hooks/useCoupons';
import { useChannels } from '@/hooks/useChannels';
import {
  createClaimLink,
  downloadClaimLinkQr,
  setClaimLinkStatus,
  useCouponClaimLinks,
  type CouponClaimLink,
} from '@/hooks/useCouponClaimLinks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage } from '@/lib/api-error';
import { ModalShell } from '@/components/coupons/form/ModalShell';
import { copyText, saveBlob } from './detail-helpers';

interface Props {
  coupon: Coupon;
  canManage: boolean;
  showOk: (message: string) => void;
  showError: (message: string) => void;
}

/** 領券連結支援的渠道（後端 CLAIM_CHANNEL_TYPES） */
const CHANNEL_LABEL: Record<string, string> = { LINE: 'LINE', FB: 'Facebook', THREADS: 'Instagram' };

interface ChannelOption {
  id: string;
  channelType: string;
  displayName: string;
  isActive?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
function dateTimeText(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function periodText(link: Pick<CouponClaimLink, 'startAt' | 'endAt'>): string {
  if (!link.startAt && !link.endAt) return '不限期間';
  if (link.startAt && link.endAt) return `${dateTimeText(link.startAt)} – ${dateTimeText(link.endAt)}`;
  return link.startAt ? `${dateTimeText(link.startAt)} 起` : `至 ${dateTimeText(link.endAt)}`;
}

function StatusBadge({ status }: { status: CouponClaimLink['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        status === 'ACTIVE' ? 'border-success/30 bg-success-subtle text-success' : 'border-transparent bg-muted text-muted-foreground',
      )}
    >
      {status === 'ACTIVE' ? '啟用中' : '已停用'}
    </span>
  );
}

function CreateDialog({
  open,
  couponId,
  channels,
  onClose,
  onCreated,
}: {
  open: boolean;
  couponId: string;
  channels: ChannelOption[];
  onClose: () => void;
  onCreated: (link: CouponClaimLink) => void;
}) {
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setSubmitError(null);
    if (!name.trim()) return setFieldError('請輸入連結名稱');
    if (!channelId) return setFieldError('請選擇領券的渠道');
    if (startAt && endAt && endAt <= startAt) return setFieldError('結束時間須晚於開始時間');
    setFieldError(null);
    setBusy(true);
    try {
      const created = await createClaimLink(couponId, {
        name: name.trim(),
        channelId,
        // datetime-local 是瀏覽器所在時區的時間，換成 ISO 再送，伺服器才不會當成 UTC
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
      });
      setName('');
      setChannelId('');
      setStartAt('');
      setEndAt('');
      onCreated(created);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, '建立失敗，請稍後再試'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open={open}
      title="建立領券連結"
      description="顧客開啟連結後，到你選的渠道傳送領券訊息就會收到這張券。"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? '建立中…' : '建立'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="claim-link-name" className="text-sm font-medium text-foreground">
            連結名稱
          </label>
          <Input
            id="claim-link-name"
            data-autofocus
            value={name}
            maxLength={30}
            placeholder="例如：門市海報、官網橫幅"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">用來分辨投放位置，也會顯示在序號明細的發放來源。</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="claim-link-channel" className="text-sm font-medium text-foreground">
            領券的渠道
          </label>
          <select
            id="claim-link-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">請選擇渠道</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.displayName}（${CHANNEL_LABEL[c.channelType] ?? c.channelType}）`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">代碼只在這個官方帳號或粉專有效。LINE 顧客要先加入好友才能傳送。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="claim-link-start" className="text-sm font-medium text-foreground">
              開始時間（選填）
            </label>
            <Input id="claim-link-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="claim-link-end" className="text-sm font-medium text-foreground">
              結束時間（選填）
            </label>
            <Input id="claim-link-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
        {submitError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[72px]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value.toLocaleString('zh-TW')}</div>
    </div>
  );
}

export function CouponClaimLinksPanel({ coupon, canManage, showOk, showError }: Props) {
  const marketing = coupon.purpose === 'MARKETING';
  const { links, error, isLoading, mutate } = useCouponClaimLinks(marketing ? coupon.id : null);
  const { channels } = useChannels();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (!marketing) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        客服補償券不能建立領券連結。公開散布的連結沒有指定對象，任何人都能領取，只適合行銷券。
      </div>
    );
  }

  const claimChannels = (channels as ChannelOption[]).filter((c) => c.isActive !== false && c.channelType in CHANNEL_LABEL);
  const canCreate = canManage && (coupon.status === 'ACTIVE' || coupon.status === 'DRAFT');

  async function toggle(link: CouponClaimLink) {
    const next = link.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setPending(link.id);
    try {
      await setClaimLinkStatus(coupon.id, link.id, next);
      showOk(next === 'ACTIVE' ? '已重新啟用領券連結' : '已停用領券連結');
      await mutate();
    } catch (err) {
      showError(getApiErrorMessage(err, '更新失敗，請稍後再試'));
    } finally {
      setPending(null);
    }
  }

  async function download(link: CouponClaimLink) {
    try {
      saveBlob(await downloadClaimLinkQr(coupon.id, link.id), `領券連結-${link.name}-${link.code}.png`);
    } catch (err) {
      showError(getApiErrorMessage(err, 'QR Code 下載失敗，請稍後再試'));
    }
  }

  async function copy(link: CouponClaimLink) {
    if (await copyText(link.url)) showOk('已複製網址');
    else showError('無法複製，請手動選取網址');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          把領券網址或 QR Code 放在海報、官網或圖文選單。顧客開啟後到指定渠道傳送領券訊息，系統會直接在對話中發券；
          每人上限與發行總量照常計算。
        </p>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            建立領券連結
          </Button>
        )}
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {getApiErrorMessage(error, '領券連結載入失敗')}
          <Button variant="outline" size="sm" onClick={() => mutate()}>
            重試
          </Button>
        </div>
      ) : isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="載入中" />
      ) : links.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          還沒有領券連結
        </div>
      ) : (
        <ul className="space-y-3">
          {links.map((link) => (
            <li key={link.id} aria-label={link.name} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{link.name}</span>
                    <StatusBadge status={link.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span>{link.channel.displayName}</span>
                    <span>{`（${CHANNEL_LABEL[link.channel.channelType] ?? link.channel.channelType}）· ${periodText(link)} · 代碼 `}</span>
                    <span className="font-mono">{link.code}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="break-all font-mono text-xs text-foreground">{link.url}</span>
                    <button
                      type="button"
                      onClick={() => copy(link)}
                      aria-label="複製網址"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {!link.channel.ready && (
                    <p className="text-xs text-warning">
                      這個渠道沒有設定公開帳號 ID 或已停用，顧客無法開啟對話。請到渠道設定填寫導流識別。
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <Metric label="開啟數" value={link.openCount} />
                  <Metric label="領取數" value={link.claimCount} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => download(link)}>
                  <Download className="h-4 w-4" />
                  下載 QR Code
                </Button>
                {canManage && (
                  <Button variant="outline" size="sm" disabled={pending === link.id} onClick={() => toggle(link)}>
                    {link.status === 'ACTIVE' ? '停用' : '重新啟用'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateDialog
        open={creating}
        couponId={coupon.id}
        channels={claimChannels}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          showOk('已建立領券連結');
          void mutate();
        }}
      />
    </div>
  );
}
