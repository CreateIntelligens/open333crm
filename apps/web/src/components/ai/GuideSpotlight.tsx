'use client';

/**
 * 導覽的聚光框：在標示的元素外圍畫框，其他區域變暗，旁邊顯示步驟說明。
 *
 * 遮罩不攔截滑鼠（pointer-events-none），員工可以直接點擊並填寫被標示的欄位。
 * 按 Esc、按「知道了」、點擊說明卡片以外的地方，或元素從畫面移除時，聚光框關閉。
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

const PADDING = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuideSpotlight({ target, note, onClose }: { target: HTMLElement; note: string; onClose: () => void }) {
  const [rect, setRect] = useState<Rect | null>(null);

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
      if (!(e.target instanceof Element) || !e.target.closest('[data-guide-spotlight-card]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onClose]);

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
        data-guide-spotlight-card
        role="dialog"
        aria-label="操作提示"
        className="pointer-events-auto absolute w-72 rounded-xl border border-border bg-background p-4 shadow-lg"
        style={{
          left: Math.min(Math.max(box.left, 16), window.innerWidth - 304),
          ...(below ? { top: box.top + box.height + 12 } : { top: Math.max(box.top - 12 - 120, 16) }),
        }}
      >
        <p className="text-sm text-foreground">{note}</p>
        <div className="mt-3 flex justify-end">
          <Button size="xs" onClick={onClose}>
            知道了
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
