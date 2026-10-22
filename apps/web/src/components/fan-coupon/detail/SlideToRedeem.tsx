'use client';

/**
 * 滑動核銷元件（Figma 顧客端 F.11；原型規格 1.5）。
 * 以持續動作取代單次點擊，降低誤觸（spec「顧客自助核銷」）。
 *
 * - 觸控與滑鼠都走 pointer events，按下時 setPointerCapture，手指移出把手也能繼續拖。
 * - 放開時位移超過 90% 才確認，否則以動畫彈回起點。
 * - 鍵盤替代：把手是 role="slider"，聚焦後按 Enter（或空白鍵）一次進入待確認，再按一次確認；
 *   方向鍵每次移動 25%，移到底即確認。
 */
import React, { useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const HANDLE = 44;
const PADDING = 2;
const THRESHOLD = 0.9;

interface Props {
  onConfirm: () => void;
  /** 送出中：鎖定元件並顯示讀取中 */
  busy?: boolean;
  disabled?: boolean;
}

export function SlideToRedeem({ onConfirm, busy = false, disabled = false }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startRatio: number } | null>(null);
  const [ratio, setRatio] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const locked = busy || disabled;

  const maxX = () => {
    const width = trackRef.current?.getBoundingClientRect().width ?? 0;
    return Math.max(1, width - HANDLE - PADDING * 2);
  };

  const confirm = () => {
    setRatio(1);
    setArmed(false);
    onConfirm();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startRatio: ratio };
    setDragging(true);
    setArmed(false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || locked) return;
    const next = drag.current.startRatio + (e.clientX - drag.current.startX) / maxX();
    setRatio(Math.min(1, Math.max(0, next)));
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const final = Math.min(1, Math.max(0, drag.current.startRatio + (e.clientX - drag.current.startX) / maxX()));
    drag.current = null;
    setDragging(false);
    if (final > THRESHOLD && !locked) confirm();
    else setRatio(0);
  };

  const cancelDrag = () => {
    drag.current = null;
    setDragging(false);
    setRatio(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (armed) confirm();
      else setArmed(true);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(1, ratio + 0.25);
      if (next >= 1) confirm();
      else setRatio(next);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setRatio(Math.max(0, ratio - 0.25));
    } else if (e.key === 'Escape') {
      setArmed(false);
      setRatio(0);
    }
  };

  const label = busy ? '核銷中…' : armed ? '再按一次 Enter 確認核銷' : '向右滑動以核銷';
  const offset = `calc(${ratio} * (100% - ${HANDLE + PADDING * 2}px))`;

  return (
    <div
      ref={trackRef}
      data-slide-track
      className={cn(
        'relative h-12 w-full select-none overflow-hidden rounded-full',
        dragging ? 'bg-primary/20' : 'bg-primary/15',
        disabled && 'opacity-60',
      )}
    >
      {/* 已滑區 */}
      <div
        aria-hidden
        className={cn('absolute inset-y-0 left-0 rounded-full bg-primary/40', !dragging && 'transition-[width] duration-200 motion-reduce:transition-none')}
        style={{ width: `calc(${offset} + ${HANDLE + PADDING * 2}px)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-base font-semibold text-primary-hover"
      >
        {label}
      </span>
      <div
        role="slider"
        tabIndex={locked ? -1 : 0}
        aria-label="向右滑動以核銷"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={busy ? '核銷中' : armed ? '待確認，再按一次 Enter 確認核銷' : `${Math.round(ratio * 100)}%`}
        aria-describedby="slide-redeem-hint"
        aria-disabled={locked}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancelDrag}
        onKeyDown={onKeyDown}
        onBlur={() => setArmed(false)}
        className={cn(
          'absolute top-[2px] flex h-11 w-11 touch-none items-center justify-center rounded-full bg-primary text-primary-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
          !dragging && 'transition-[left] duration-200 motion-reduce:transition-none',
        )}
        style={{ left: `calc(${PADDING}px + ${offset})` }}
      >
        {busy ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <ArrowRight aria-hidden className="h-4 w-4" />
        )}
      </div>
      <span id="slide-redeem-hint" className="sr-only">
        使用鍵盤時，聚焦此控制項後按 Enter 兩次確認核銷。
      </span>
    </div>
  );
}
