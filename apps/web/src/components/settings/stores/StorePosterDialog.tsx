"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadErrorNotice } from "@/components/shared/LoadErrorNotice";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import type { Store, StorePoster } from "./store-types";

const PRINT_ROOT_ID = "store-poster-print-root";

/**
 * 列印時只印海報：其餘元素 visibility:hidden，海報本身固定在頁首。
 * 用 visibility 而非 display，因為海報在 <dialog>（top layer）裡，祖先不能被 display:none。
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden !important; }
  dialog::backdrop { background: transparent !important; }
  #${PRINT_ROOT_ID}, #${PRINT_ROOT_ID} * { visibility: visible !important; }
  #${PRINT_ROOT_ID} {
    position: fixed; left: 0; top: 0; width: 100%;
    display: flex; justify-content: center;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  #${PRINT_ROOT_ID} [data-testid="store-poster"] { width: 150mm; max-width: none; box-shadow: none; }
}
`;

/** 櫃檯海報：QR Code 與網址都由後端提供（GET /stores/:id/poster），只開啟核銷台登入頁，不含憑證。 */
export function StorePosterDialog({ store, onClose }: { store: Store | null; onClose: () => void }) {
  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      {store && <PosterContent key={store.id} store={store} onClose={onClose} />}
    </Dialog>
  );
}

function PosterContent({ store, onClose }: { store: Store; onClose: () => void }) {
  const [poster, setPoster] = useState<StorePoster | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setPoster(null);
    try {
      const res = await api.get<{ data: StorePoster }>(`/stores/${store.id}/poster`);
      setPoster(res.data.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "請稍後重試"));
    }
  }, [store.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DialogContent className="max-w-lg">
      <style>{PRINT_CSS}</style>
      <DialogHeader>
        <DialogTitle>櫃檯海報</DialogTitle>
        <p className="text-sm text-muted-foreground">
          印出後貼在 {store.name} 櫃檯，店員用手機相機掃描即可開啟核銷台登入頁。
        </p>
      </DialogHeader>

      {error ? (
        <LoadErrorNotice title="無法產生海報" message={error} onRetry={load} />
      ) : !poster ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> 海報產生中
        </div>
      ) : (
        <div id={PRINT_ROOT_ID} className="flex justify-center">
          <PosterSheet poster={poster} />
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>
          關閉
        </Button>
        <Button onClick={() => window.print()} disabled={!poster}>
          <Printer /> 列印
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * 海報本體。這是實體紙張的預覽，固定白底深字（深色模式下也是一張白紙），
 * 列印時才不會印出深色底。版面依設計稿「提供QR code」（A1_櫃檯海報）。
 */
function PosterSheet({ poster }: { poster: StorePoster }) {
  return (
    <article
      data-testid="store-poster"
      className="w-full max-w-[360px] rounded-2xl border border-neutral-200 bg-[#FAFAF7] px-8 py-9 text-center text-neutral-900 shadow-sm"
    >
      <p className="text-sm font-semibold tracking-wide text-neutral-500">{poster.storeName}</p>
      <h3 className="mt-2 text-4xl font-black tracking-tight">門市核銷台</h3>
      <div className="mx-auto mt-6 w-fit rounded-2xl border border-neutral-200 bg-white p-4">
        {/* data URL 由後端產生，不經第三方服務；next/image 不適用 data URL */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster.qrDataUrl} alt={`${poster.storeName} 核銷台登入頁 QR Code`} className="h-48 w-48" />
      </div>
      <p className="mt-6 text-lg font-bold leading-7">
        <span className="block">店員請用手機相機掃描</span>
        <span className="block">即可開啟核銷台</span>
      </p>
      <hr className="my-5 border-dashed border-neutral-300" />
      <p className="text-sm leading-6 text-neutral-500">此 QR Code 只會開啟登入頁，需輸入門市帳號與密碼才能核銷</p>
      <p className="mt-4 text-sm text-neutral-500">無法掃描時，請在瀏覽器輸入</p>
      {/* QR 帶門市 id；印給人手打的是不帶 id 的短網址（帳號本身綁定門市） */}
      <p className="mt-1 break-all font-mono text-sm font-bold">{poster.shortUrl}</p>
    </article>
  );
}
