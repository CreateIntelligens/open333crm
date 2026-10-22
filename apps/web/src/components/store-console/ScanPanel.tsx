'use client';

/**
 * 掃描核銷（mobile-prototype-spec 2.4）。
 *
 * 以 getUserMedia 取後鏡頭影像，用 canvas 逐格擷取取景區域，交給 jsQR 解碼。
 * jsQR 以動態 import 載入，只有核銷台會下載。顧客 QR 內容固定是券號字串（不輪替、不簽章）。
 *
 * 狀態：idle ─8 秒沒辨識→ slow（提示改用手動）；辨識到碼 → scanning（短暫）→ hit（框轉綠、查券中）。
 * 光線不足以影像平均亮度判斷；手電筒只有 track 回報支援 torch 時才顯示（iOS Safari 不支援，會隱藏）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CameraOff, Flashlight, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { vibrate } from '@/hooks/useStoreConsole';
import { Button } from './ui';

/** 同一個碼在這段時間內重複掃到就忽略，不重複送出 */
const DUPLICATE_MS = 3000;
const SLOW_MS = 8000;
/** 辨識到碼後顯示「辨識中」的時間，讓店員看得到回饋再進入查詢 */
const SCANNING_MS = 400;
const DECODE_INTERVAL_MS = 120;
/** 平均亮度（0–255）低於此值視為光線不足 */
const DARK_LUMA = 45;

type CameraState = 'starting' | 'live' | 'denied' | 'unavailable';
type ScanState = 'idle' | 'scanning' | 'hit';

export interface LastScan {
  code: string;
  at: number;
}

interface Props {
  /** 查券中：暫停解碼，框維持「已辨識」 */
  busy: boolean;
  /** 跨越重新掛載保存上一次掃到的碼（3 秒內同一碼忽略） */
  lastScanRef: React.MutableRefObject<LastScan | null>;
  onDetected: (code: string) => void;
  onManual: () => void;
  /** 查券失敗等錯誤，顯示在取景框下方 */
  error?: string | null;
}

/** torch 不在 TypeScript 的 DOM 型別中（只有部分 Android Chrome 支援） */
type TorchTrack = Omit<MediaStreamTrack, 'getCapabilities'> & { getCapabilities?: () => { torch?: boolean } };

export function ScanPanel({ busy, lastScanRef, onDetected, onManual, error }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [slow, setSlow] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchError, setTorchError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // 查券結束（失敗回到掃描）時，畫面回到待機；仍在查券時維持「已辨識」
  const shown: ScanState = scanState === 'hit' && !busy ? 'idle' : scanState;
  const paused = busy || scanState === 'scanning';

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 開啟相機與解碼迴圈；attempt 變動（重新嘗試）時重來
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    async function start() {
      const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
      if (!media?.getUserMedia) {
        setCamera('unavailable');
        return;
      }
      setCamera('starting');
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as unknown as TorchTrack | undefined;
      try {
        setTorchSupported(Boolean(track?.getCapabilities?.().torch));
      } catch {
        setTorchSupported(false);
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // iOS 需要 muted＋playsInline 才能自動播放；兩者已設定，仍失敗時影像會在使用者觸碰後開始
      }
      if (cancelled) return;
      setCamera('live');

      let jsQR: typeof import('jsqr').default;
      try {
        jsQR = (await import('jsqr')).default;
      } catch {
        if (!cancelled) setCamera('unavailable');
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setCamera('unavailable');
        return;
      }
      let lastDecode = 0;
      let lastLight = 0;
      let dark = 0;
      let bright = 0;

      const tick = (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (pausedRef.current || t - lastDecode < DECODE_INTERVAL_MS) return;
        lastDecode = t;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh || video.readyState < 2) return;
        // 只取畫面中央的正方形（取景框所在的區域），縮到最多 480px 加快解碼
        const side = Math.min(vw, vh);
        const size = Math.min(480, side);
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
        const image = ctx.getImageData(0, 0, size, size);

        // 每秒估一次平均亮度；連續兩次偏暗才提示，避免閃爍
        if (t - lastLight > 1000) {
          lastLight = t;
          const d = image.data;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 64) {
            sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            n += 1;
          }
          if (sum / n < DARK_LUMA) {
            dark += 1;
            bright = 0;
            if (dark >= 2) setLowLight(true);
          } else {
            bright += 1;
            dark = 0;
            if (bright >= 2) setLowLight(false);
          }
        }

        const result = jsQR(image.data, size, size, { inversionAttempts: 'dontInvert' });
        const code = result?.data?.trim();
        if (!code) return;
        const now = Date.now();
        const last = lastScanRef.current;
        if (last && last.code === code && now - last.at < DUPLICATE_MS) return;
        lastScanRef.current = { code, at: now };
        pausedRef.current = true;
        vibrate(40);
        setSlow(false);
        setScanState('scanning');
        timers.push(
          window.setTimeout(() => {
            if (cancelled) return;
            setScanState('hit');
            onDetectedRef.current(code);
          }, SCANNING_MS),
        );
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      stop();
    };
  }, [attempt, lastScanRef, stop]);

  // 8 秒沒辨識到：提示改用手動輸入
  useEffect(() => {
    if (camera !== 'live' || shown !== 'idle' || slow) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [camera, shown, slow]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
      setTorchError(null);
    } catch {
      setTorchError('無法開啟手電筒，請改到較亮的地方掃描');
    }
  }

  if (camera === 'denied' || camera === 'unavailable') {
    const denied = camera === 'denied';
    return (
      <div className="flex flex-1 flex-col bg-background px-6 pb-[max(16px,env(safe-area-inset-bottom))] pt-10 text-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
          <CameraOff className="h-6 w-6" aria-hidden />
        </div>
        <h2 className="mt-5 text-xl font-semibold">{denied ? '無法使用相機' : '無法開啟相機'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {denied
            ? '核銷台需要相機權限才能掃描 QR Code。開啟權限前，可以先用手動核銷輸入序號。'
            : '找不到可用的相機，或瀏覽器不支援相機（核銷台需以 https 開啟）。可以先用手動核銷輸入序號。'}
        </p>
        {denied && (
          <ol className="mt-5 list-decimal space-y-1 rounded-xl bg-muted py-3 pl-9 pr-4 text-sm leading-6 text-muted-foreground">
            <li>打開手機的「設定」</li>
            <li>找到使用中的瀏覽器（Safari 或 Chrome）</li>
            <li>將「相機」改為「允許」，再回到核銷台</li>
          </ol>
        )}
        <div className="mt-auto space-y-3 pt-8">
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            重新嘗試
          </Button>
          <Button onClick={onManual}>改用手動核銷</Button>
        </div>
      </div>
    );
  }

  const hint =
    shown === 'scanning'
      ? { main: '辨識中，請保持手機穩定', sub: '距離約 15–25 公分最容易辨識' }
      : shown === 'hit'
        ? { main: '已辨識', sub: '正在查詢這張券…' }
        : lowLight
          ? { main: '光線不足，不容易辨識', sub: torchSupported ? undefined : '請移到較亮的地方' }
          : { main: '請將顧客手機上的 QR Code 對準框內', sub: undefined };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#0B0E12] text-white">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden
        className={cn('absolute inset-0 h-full w-full object-cover', camera !== 'live' && 'invisible')}
      />
      <div className="relative z-10 flex flex-1 flex-col items-center px-5 pt-8">
        <div aria-live="polite" className="min-h-[52px] text-center">
          <p className="text-[15px] font-semibold">{hint.main}</p>
          {hint.sub && <p className="mt-1 text-[13px] text-white/70">{hint.sub}</p>}
        </div>

        {/* 取景框 248×248：框外加暗，四角 L 形框線；辨識成功轉綠並略縮小 */}
        <div
          className={cn(
            'relative mt-4 h-[248px] w-[248px] rounded-2xl shadow-[0_0_0_9999px_rgba(11,14,18,0.55)] transition-transform duration-200',
            shown === 'hit' && 'scale-95',
          )}
        >
          {(['left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl'] as const).map(
            (pos) => (
              <span
                key={pos}
                aria-hidden
                className={cn('absolute h-10 w-10', pos, shown === 'hit' ? 'border-[#34C759]' : 'border-white')}
              />
            ),
          )}
          {shown === 'scanning' && (
            <span aria-hidden className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse rounded bg-white/80 motion-reduce:animate-none" />
          )}
        </div>

        {torchSupported && (lowLight || torchOn) && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-pressed={torchOn}
            className={cn(
              'mt-6 flex h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
              torchOn ? 'border-[#FFD60A] bg-[#FFD60A] text-[#0B0E12]' : 'border-white/40 bg-white/10 text-white',
            )}
          >
            <Flashlight className="h-4 w-4" aria-hidden />
            {torchOn ? '關閉手電筒' : '輕觸開啟手電筒'}
          </button>
        )}
        {torchError && <p role="alert" className="mt-3 text-center text-sm text-[#FFB4B4]">{torchError}</p>}
        {error && (
          <p role="alert" className="mt-5 w-full rounded-xl bg-[#3A1416] px-4 py-3 text-center text-sm font-medium text-[#FFB4B4]">
            {error}
          </p>
        )}

        {slow && shown === 'idle' && (
          <div className="mt-auto mb-[max(20px,env(safe-area-inset-bottom))] w-full rounded-2xl bg-white p-4 text-[#11161D] shadow-lg">
            <p className="text-base font-semibold">掃不到嗎？可改用手動輸入</p>
            <p className="mt-1 text-sm text-[#5B6675]">輸入顧客券上 QR Code 下方的序號即可。</p>
            <button
              type="button"
              onClick={onManual}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#378ADD] text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#378ADD] focus-visible:ring-offset-2"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              改用手動輸入
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
