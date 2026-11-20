'use client';

/**
 * 導覽的聚光框與說明卡（規格 dashboard-guide-assistant「導覽逐步顯示說明卡」）。
 * 在標示的元素外圍畫框，其他區域變暗，旁邊的說明卡顯示「第 n / N 步」與步驟說明。
 *
 * - 遮罩不攔截滑鼠（pointer-events-none），員工可以直接點擊並填寫被標示的元素。
 * - click 步驟：員工點擊元素，或按「下一步」（代員工點擊元素）時呼叫 onNext。
 * - highlight 步驟：員工按「下一步」或最後一步的「完成」時呼叫 onNext。
 * - 按 Esc、點擊說明卡與元素以外的地方，或元素從畫面移除時呼叫 onClose。
 * - 元素在原生 modal 對話框（`<dialog>` 以 showModal() 打開）裡時，聚光框放進該對話框：
 *   modal 對話框蓋在所有 z-index 之上，對話框外的元素也無法點擊。
 */
import React, { useEffect, useState } from 'react';
import type { GuideStep } from '@open333crm/shared';
import type { GuideStepProgress } from '@/lib/guide/guide-runner';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

const PADDING = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface GuideSpotlightProps {
  target: HTMLElement;
  step: GuideStep;
  progress: GuideStepProgress;
  onNext: () => void;
  onClose: () => void;
}

export function GuideSpotlight({ target, step, progress, onNext, onClose }: GuideSpotlightProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const isClick = step.action === 'click';
  const isLast = progress.index === progress.total;

  // 元素會隨捲動、對話框動畫移動：每個畫面更新一次位置
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (!target.isConnected) return onClose();
      const r = target.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [target, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const el = e.target;
      if (el instanceof Node && (target.contains(el) || card?.contains(el))) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [target, card, onClose]);

  // click 步驟：員工點擊元素（或「下一步」代為點擊）時進行下一步
  useEffect(() => {
    if (!isClick) return;
    target.addEventListener('click', onNext);
    return () => target.removeEventListener('click', onNext);
  }, [target, isClick, onNext]);

  if (!rect) return null;
  const box = {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
  // 說明卡片放在框的下方；下方空間不夠時放上方
  const below = box.top + box.height + 140 < window.innerHeight;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <div
        className="absolute rounded-lg ring-2 ring-primary transition-all duration-150"
        style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
      />
      <div
        ref={setCard}
        data-guide-spotlight-card
        role="dialog"
        aria-label="操作提示"
        className="pointer-events-auto absolute w-72 rounded-xl border border-border bg-background p-4 shadow-lg"
        style={{
          left: Math.min(Math.max(box.left, 16), window.innerWidth - 304),
          ...(below ? { top: box.top + box.height + 12 } : { top: Math.max(box.top - 12 - 120, 16) }),
        }}
      >
        <p className="text-xs text-muted-foreground">
          第 {progress.index} / {progress.total} 步
        </p>
        <p className="mt-1 text-sm text-foreground">{step.note}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={onClose}>
            結束導覽
          </Button>
          <Button size="xs" onClick={isClick ? () => target.click() : onNext}>
            {isLast && !isClick ? '完成' : '下一步'}
          </Button>
        </div>
      </div>
    </div>,
    target.closest('dialog') ?? document.body,
  );
}
