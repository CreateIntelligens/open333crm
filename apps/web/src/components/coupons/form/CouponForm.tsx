'use client';

/**
 * 建立／編輯優惠券表單（A1）。規則依《優惠券後台 UX 規則》第 3、5、6 節與 Jira CM-196。
 *
 * 三種模式：
 * - create：新建。有「儲存草稿」與「發布優惠券」。
 * - draft：編輯草稿，行為同新建（以既有草稿 id 更新）。
 * - published：編輯已發布的券。鎖定欄位唯讀，按鈕為「儲存變更」，只送有改動的可改欄位。
 *
 * 草稿只要求券名；發布才檢查全部必填。必填未完成時不開確認框，標出未填欄位並聚焦第一個。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CouponToast, useCouponToast } from '@/components/coupons/CouponToast';
import {
  checkSharedCode,
  createCoupon,
  importCodes,
  publishCoupon,
  updateCoupon,
  type Coupon,
} from '@/hooks/useCoupons';
import { useContactTags } from '@/hooks/useContactTags';
import { faceValueText, REDEEM_MODE_LABEL, validityText } from '@/lib/coupon/labels';
import { getApiErrorCode, getApiErrorMessage, getFieldErrors } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import {
  codeSummary,
  editableChanges,
  emptyValues,
  FIELD_LABEL,
  fieldDomId,
  fieldForServerMessage,
  GROUPS,
  isLocked,
  isRequired,
  MAX_NAME,
  PREFIX_MAX,
  missingItems,
  percentHint,
  risks as computeRisks,
  SECTION_OF,
  sectionDomId,
  sectionSummary,
  SECTIONS,
  TERMS_SELF_REDEEM_LINE,
  toCouponInput,
  validate,
  valuesFromCoupon,
  warnings,
  worstCost,
  type FieldKey,
  type FormMode,
  type FormValues,
  type GroupKey,
  type Risk,
  type SectionId,
} from './form-model';
import { FieldShell, Note, OptionPanel, RadioCards, TextField } from './fields';
import { CoverImageField } from './CoverImageField';
import { CodeImportField, EMPTY_IMPORT, type ImportState } from './CodeImportField';
import { ProgressAside, type ProgressItem } from './ProgressAside';
import { PublishConfirmDialog, type PublishPhase } from './PublishConfirmDialog';
import { LeaveConfirmDialog } from './LeaveConfirmDialog';
import { useLeaveGuard } from './useLeaveGuard';
import { pad2, taipeiParts } from '@/lib/taipei-time';

const LIST_HREF = '/dashboard/marketing/coupons';
/** 後端單次匯入上限 10,000 筆（coupon-import.service.ts），超過時分批送出 */
const IMPORT_BATCH = 10_000;

interface Props {
  mode: FormMode;
  coupon?: Coupon;
  /** 已領取張數（標題旁 badge） */
  claimedCount?: number;
  /** 已發放張數（發行總量下限） */
  issuedCount?: number;
  /** 這張券已匯入的序號數（草稿匯入後發布失敗、再回來編輯時），算在序號包內 */
  existingCodes?: number;
}

/** 「已儲存草稿 · HH:mm」：台灣時間（design D17） */
const hm = () => {
  const d = taipeiParts(new Date());
  return d ? `${pad2(d.hour)}:${pad2(d.minute)}` : '';
};

const snapshot = (v: FormValues) => JSON.stringify(v);

/** 捲到元素並聚焦。jsdom 沒有 scrollIntoView，所以用可選呼叫。 */
function goTo(domId: string) {
  const el = document.getElementById(domId);
  if (!el) return;
  const cell = (el.closest('[data-cell]') as HTMLElement | null) ?? el;
  cell.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
}

export function CouponForm({ mode, coupon, claimedCount = 0, issuedCount, existingCodes = 0 }: Props) {
  const router = useRouter();
  const published = mode === 'published';
  const { tags, isLoading: tagsLoading } = useContactTags();
  const { toast, showOk } = useCouponToast();

  // 初始值只在第一次 render 決定；之後以 baseline 判斷有沒有修改
  const [initial] = useState<FormValues>(() => (coupon ? valuesFromCoupon(coupon) : emptyValues()));
  const [values, setValues] = useState<FormValues>(initial);
  const [baseline, setBaseline] = useState(() => snapshot(initial));
  const [couponId, setCouponId] = useState<string | null>(coupon?.id ?? null);
  const [importState, setImportState] = useState<ImportState>(EMPTY_IMPORT);

  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [touched, setTouched] = useState<Partial<Record<SectionId, boolean>>>({});
  const [nameNeeded, setNameNeeded] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [sharedNote, setSharedNote] = useState<{ code: string; error?: string; warn?: string } | null>(null);

  const [savingDraft, setSavingDraft] = useState(false);
  const [draftAt, setDraftAt] = useState('');
  const [draftError, setDraftError] = useState('');
  const [savingChanges, setSavingChanges] = useState(false);
  const [barError, setBarError] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<PublishPhase>('review');
  const [failMessage, setFailMessage] = useState('');
  const [ack, setAck] = useState(false);

  // 非同步流程（自動存草稿、發布）要讀最新值，避免閉包拿到舊的 state
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const couponIdRef = useRef(couponId);
  couponIdRef.current = couponId;
  const importRef = useRef(importState);
  importRef.current = importState;
  const submitLock = useRef(false);
  const importedBatches = useRef(0);

  // 已選序號包但還沒匯入，離開也會遺失
  const pendingImport = importState.status === 'done' && !importState.imported && importState.codes.length > 0;
  const dirty = snapshot(values) !== baseline || pendingImport;
  const guard = useLeaveGuard(dirty);

  const ctx = useMemo(
    () => ({
      mode,
      importOk:
        importState.status === 'done' || existingCodes > 0
          ? (importState.status === 'done' && !importState.imported ? importState.codes.length : 0) + existingCodes
          : null,
      issuedCount,
    }),
    [mode, importState, issuedCount, existingCodes],
  );

  // ---- 驗證 ----
  const formatErrors = useMemo(() => validate(values, ctx), [values, ctx]);
  const formatErrorsRef = useRef(formatErrors);
  formatErrorsRef.current = formatErrors;
  const errors = useMemo(() => {
    const e: Partial<Record<FieldKey, string>> = { ...formatErrors };
    for (const [k, msg] of Object.entries(serverErrors)) if (msg && !e[k as FieldKey]) e[k as FieldKey] = msg;
    if (sharedNote?.error && sharedNote.code === values.sharedCode.trim().toUpperCase() && !e.sharedCode) e.sharedCode = sharedNote.error;
    if (nameNeeded && !values.name.trim()) e.name = '請先填寫優惠券名稱';
    return e;
  }, [formatErrors, serverErrors, sharedNote, nameNeeded, values.name, values.sharedCode]);
  const missing = useMemo(() => missingItems(values, ctx), [values, ctx]);
  const missingKeys = useMemo(() => new Set(missing.map((m) => m.key)), [missing]);
  const warns = useMemo(() => warnings(values, ctx, errors), [values, ctx, errors]);
  const riskList = useMemo(() => (published ? [] : computeRisks(values)), [values, published]);
  const worst = useMemo(() => (values.couponType ? worstCost(values) : null), [values]);
  const errorKeys = (Object.keys(errors) as FieldKey[]).filter((k) => errors[k]);

  /** 日期與驗證碼的格式錯誤在失焦或嘗試送出後才顯示，避免輸入到一半就跳紅字 */
  const shownError = (f: FieldKey): string | undefined => {
    const err = errors[f];
    if (err) {
      const delayed = f === 'startAt' || f === 'endAt' || (f === 'staffCode' && values.staffCode.length < 4);
      if (!delayed || blurred[f] || attempted) return err;
    }
    if (attempted && missingKeys.has(f)) return '此欄位必填';
    return undefined;
  };

  // ---- 修改 ----
  const markTouched = (key: FieldKey) => setTouched((t) => (t[SECTION_OF[key]] ? t : { ...t, [SECTION_OF[key]]: true }));
  const setVal = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    markTouched(key);
    if (serverErrors[key]) setServerErrors((s) => ({ ...s, [key]: undefined }));
    if (barError) setBarError('');
  };
  const blur = (f: FieldKey) => setBlurred((b) => (b[f] ? b : { ...b, [f]: true }));

  // ---- 草稿 ----
  /** 儲存草稿；成功回傳券 id。失敗時保留內容並在底部列顯示原因。 */
  const saveDraft = useCallback(async (): Promise<string | null> => {
    const v = valuesRef.current;
    if (!v.name.trim()) {
      setNameNeeded(true);
      goTo(fieldDomId('name'));
      return null;
    }
    // 格式錯誤的值轉不成 API 欄位（例如全形數字），存下去會被默默清成空白
    const badFields = (Object.keys(formatErrorsRef.current) as FieldKey[]).filter((k) => formatErrorsRef.current[k]);
    if (badFields.length > 0) {
      setAttempted(true);
      setDraftError(`儲存草稿失敗：有 ${badFields.length} 個欄位格式不正確，請修正後再儲存`);
      goTo(fieldDomId(badFields[0]));
      return null;
    }
    setSavingDraft(true);
    setDraftError('');
    try {
      const input = toCouponInput(v);
      const id = couponIdRef.current;
      const saved = id ? await updateCoupon(id, input) : await createCoupon(input);
      const newId = saved?.id ?? id;
      if (!newId) throw new Error('儲存草稿失敗');
      couponIdRef.current = newId;
      setCouponId(newId);
      setBaseline(snapshot(v));
      setDraftAt(hm());
      return newId;
    } catch (err) {
      // 後端 Zod 錯誤帶欄位原因：直接標在對應欄位（路徑與表單欄位同名）
      const byField = getFieldErrors(err);
      const fieldEntries = Object.entries(byField).filter(([k]) => k in valuesRef.current);
      const msg = fieldEntries[0]?.[1] ?? getApiErrorMessage(err, '網路連線逾時。');
      if (fieldEntries.length > 0) {
        setServerErrors((s) => ({ ...s, ...Object.fromEntries(fieldEntries) }));
      } else {
        const field = fieldForServerMessage(msg);
        if (field) setServerErrors((s) => ({ ...s, [field]: msg }));
      }
      setDraftError(`儲存草稿失敗：${msg}`);
      return null;
    } finally {
      setSavingDraft(false);
    }
  }, []);

  const onSaveDraftClick = async () => {
    if (savingDraft) return;
    const id = await saveDraft();
    if (id) {
      guard.release();
      router.push(`${LIST_HREF}?draftSaved=1`);
    }
  };

  /** 序號包檢查需要券 id：還沒有時自動儲存草稿 */
  const ensureCouponId = useCallback(async () => couponIdRef.current ?? (await saveDraft()), [saveDraft]);

  // ---- 發布 ----
  const focusFirstProblem = () => {
    setAttempted(true);
    const first = missing[0]?.target ?? (errorKeys[0] ? fieldDomId(errorKeys[0]) : null);
    if (first) goTo(first);
  };

  const onPublishClick = () => {
    if (missing.length || errorKeys.length) {
      focusFirstProblem();
      return;
    }
    setAttempted(true);
    setAck(false);
    setPhase('review');
    setFailMessage('');
    setConfirmOpen(true);
  };

  const doPublish = async () => {
    if (submitLock.current) return;
    if (phase === 'review' && riskList.length > 0 && !ack) return;
    submitLock.current = true;
    setPhase('submitting');
    try {
      const input = toCouponInput(valuesRef.current);
      let id = couponIdRef.current;
      if (id) {
        await updateCoupon(id, input);
      } else {
        id = (await createCoupon(input)).id;
        couponIdRef.current = id;
        setCouponId(id);
      }
      const imp = importRef.current;
      if (valuesRef.current.codeMode === 'IMPORTED_CODES' && imp.status === 'done' && !imp.imported) {
        // 分批匯入；重試時跳過已成功的批次
        for (let i = importedBatches.current * IMPORT_BATCH; i < imp.codes.length; i += IMPORT_BATCH) {
          await importCodes(id, imp.codes.slice(i, i + IMPORT_BATCH).join('\n'));
          importedBatches.current += 1;
        }
        setImportState((s) => ({ ...s, imported: true }));
      }
      await publishCoupon(id);
      guard.release();
      router.push(`${LIST_HREF}/${id}?published=1`);
    } catch (err) {
      setFailMessage(getApiErrorMessage(err, '網路連線逾時'));
      setPhase('failed');
    } finally {
      submitLock.current = false;
    }
  };

  const closeConfirm = () => {
    if (phase === 'submitting') return;
    setConfirmOpen(false);
    setPhase('review');
  };

  const fixRisk = (r: Risk) => {
    setConfirmOpen(false);
    setPhase('review');
    // 等確認框卸載、焦點歸還後再跳到欄位
    setTimeout(() => goTo(r.target), 0);
  };

  // ---- 已發布：儲存變更 ----
  const saveChanges = async (): Promise<boolean> => {
    if (submitLock.current) return false;
    if (missing.length || errorKeys.length) {
      focusFirstProblem();
      return false;
    }
    const diff = editableChanges(initial, valuesRef.current);
    if (Object.keys(diff).length === 0) {
      showOk('沒有修改任何欄位');
      return false;
    }
    submitLock.current = true;
    setSavingChanges(true);
    setBarError('');
    try {
      await updateCoupon(couponIdRef.current!, diff);
      setBaseline(snapshot(valuesRef.current));
      return true;
    } catch (err) {
      const msg = getApiErrorMessage(err, '儲存失敗，請稍後重試');
      const field = getApiErrorCode(err) === 'COUPON_LOCKED' ? null : fieldForServerMessage(msg);
      if (field) {
        setServerErrors((s) => ({ ...s, [field]: msg }));
        setAttempted(true);
        setTimeout(() => goTo(fieldDomId(field)), 0);
      } else {
        setBarError(msg);
      }
      return false;
    } finally {
      submitLock.current = false;
      setSavingChanges(false);
    }
  };

  const onSaveChangesClick = async () => {
    if (await saveChanges()) {
      guard.release();
      router.push(`${LIST_HREF}/${couponIdRef.current}?updated=1`);
    }
  };

  // ---- 離開確認框的「儲存」 ----
  const onLeaveSave = async () => {
    if (published) {
      guard.stay();
      if (await saveChanges()) guard.leave();
      return;
    }
    if (!valuesRef.current.name.trim()) {
      guard.stay();
      setNameNeeded(true);
      setTimeout(() => goTo(fieldDomId('name')), 0);
      return;
    }
    const id = await saveDraft();
    if (id) guard.leave();
    else guard.stay();
  };

  // ---- 共用碼：失焦時檢查是否與其他券重複 ----
  const checkShared = async () => {
    blur('sharedCode');
    const code = values.sharedCode.trim().toUpperCase();
    if (!code || formatErrors.sharedCode) return;
    try {
      const r = await checkSharedCode(code, couponIdRef.current ?? undefined);
      setSharedNote(r.available ? { code } : { code, error: r.message ?? '與其他券重複，請換一組券號' });
    } catch (err) {
      setSharedNote({ code, warn: `無法確認券號是否重複（${getApiErrorMessage(err, '網路錯誤')}），發布時會再檢查` });
    }
  };

  // ---- 組畫面 ----
  const fp = (f: Exclude<FieldKey, 'codes'>) => ({
    id: fieldDomId(f),
    label: FIELD_LABEL[f],
    value: String(values[f] ?? ''),
    onChange: (v: string) => setVal(f, v as never),
    onBlur: () => blur(f),
    required: isRequired(f),
    locked: isLocked(mode, f),
    error: shownError(f),
    warn: warns[f],
  });

  const group = (g: GroupKey) => (
    <RadioCards
      idPrefix={`coupon-opt-${g}`}
      label={GROUPS[g].label}
      caption={GROUPS[g].caption}
      options={GROUPS[g].options}
      value={values[g]}
      onChange={(v) => setVal(g, v as never)}
      locked={isLocked(mode, g)}
      missing={attempted && missingKeys.has(g)}
    />
  );

  const today = emptyValues().startAt;
  const termsHasSelfLine = values.terms.includes(TERMS_SELF_REDEEM_LINE);
  const highValueRisk = computeRisks(values).find((r) => r.key === 'redeemMode');

  const sectionStatus = (sec: SectionId): { label: string; tone: 'danger' | 'warn' | 'ok' | 'neutral' | 'none' } => {
    const errCount = errorKeys.filter((k) => SECTION_OF[k] === sec).length;
    if (errCount) return { label: `${errCount} 個錯誤`, tone: 'danger' };
    if (missing.some((m) => m.section === sec)) return { label: '', tone: 'none' };
    if (riskList.some((r) => r.section === sec)) return { label: '請確認', tone: 'warn' };
    if (touched[sec] || mode !== 'create') return { label: '已確認', tone: 'ok' };
    return { label: '沿用預設', tone: 'neutral' };
  };

  const progress: ProgressItem[] = SECTIONS.map((s, i) => {
    const st = sectionStatus(s.id);
    return {
      id: s.id,
      num: i + 1,
      title: s.title,
      summary: sectionSummary(values, s.id, ctx),
      done: st.tone !== 'danger' && st.tone !== 'none',
      hasError: st.tone === 'danger',
    };
  });

  const input = toCouponInput(values);
  const confirmRows = [
    { label: '券型與面額', value: faceValueText(input as Coupon) },
    {
      label: '效期',
      value: validityText({
        ...(input as Coupon),
        // 只有日期時補上台灣時間的午夜（design D17），任何時區都顯示同一天
        startAt: input.startAt ? `${input.startAt}T00:00:00+08:00` : null,
        endAt: input.endAt ? `${input.endAt}T00:00:00+08:00` : null,
      }),
    },
    { label: '序號模式', value: codeSummary(values, ctx) },
    { label: '核銷方式', value: values.redeemMode ? REDEEM_MODE_LABEL[values.redeemMode] : '—' },
  ];
  const pinEmphasis = values.redeemMode === 'STAFF_CODE';
  const pinLine = pinEmphasis
    ? `店員驗證碼：${values.staffCode || '—'}（發布後無法修改）`
    : '發布後券型與面額、效期、序號模式、核銷方式將無法修改';

  const pageTitle = published ? '編輯優惠券' : mode === 'draft' ? '編輯草稿' : '建立優惠券';
  const crumb = published ? '編輯優惠券' : mode === 'draft' ? '編輯草稿' : '建立優惠券';
  const busy = savingDraft || savingChanges || phase === 'submitting';

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-4 pb-8 pt-6 sm:px-8">
        {/* 麵包屑：點擊走離開確認 */}
        <nav aria-label="麵包屑" className="mb-2 text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <a href="/dashboard/marketing" className="hover:text-foreground" onClick={(e) => { e.preventDefault(); guard.navigate('/dashboard/marketing'); }}>
                行銷
              </a>
            </li>
            <li aria-hidden="true">›</li>
            <li>
              <a href={LIST_HREF} className="hover:text-foreground" onClick={(e) => { e.preventDefault(); guard.navigate(LIST_HREF); }}>
                優惠券
              </a>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="font-medium text-foreground">
              {crumb}
            </li>
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{pageTitle}</h1>
          {published && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              已領取 <span className="font-mono">{claimedCount.toLocaleString('en-US')}</span> 張
            </span>
          )}
          {coupon?.displayCode && <span className="font-mono text-xs text-muted-foreground">{coupon.displayCode}</span>}
        </div>
        <p className="mt-1 text-sm text-foreground/80">
          依序設定券型、效期、券號與核銷方式；每個選擇都會改變下方需要填寫的內容，
          <span className="text-muted-foreground">發放對象在行銷活動或廣播中設定</span>
        </p>

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
          <ProgressAside variant="mobile" items={progress} worst={null} onJump={(id) => goTo(sectionDomId(id))} />

          <form
            className="flex min-w-0 flex-1 flex-col gap-5"
            noValidate
            onSubmit={(e) => e.preventDefault()}
            aria-label={pageTitle}
          >
            {SECTIONS.map((sec, i) => {
              const st = sectionStatus(sec.id);
              return (
                <section
                  key={sec.id}
                  id={sectionDomId(sec.id)}
                  tabIndex={-1}
                  aria-labelledby={`${sectionDomId(sec.id)}-h`}
                  className="scroll-mt-6 overflow-hidden rounded-2xl border bg-background outline-none"
                >
                  <header className="flex items-start gap-3 border-b bg-muted/40 px-5 py-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 id={`${sectionDomId(sec.id)}-h`} className={cn('text-base font-semibold', st.tone === 'danger' ? 'text-destructive' : 'text-foreground')}>
                        {sec.title}
                      </h2>
                      <p className="text-xs text-muted-foreground">{sec.desc}</p>
                    </div>
                    {st.label && (
                      <span
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-full border px-2 py-px text-xs font-semibold',
                          st.tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive',
                          st.tone === 'warn' && 'border-warning/30 bg-warning-subtle text-warning',
                          st.tone === 'ok' && 'border-success/30 bg-success-subtle text-success',
                          st.tone === 'neutral' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {st.label}
                      </span>
                    )}
                  </header>
                  <div className="flex flex-col divide-y">{renderSection(sec.id)}</div>
                </section>
              );
            })}
          </form>

          <ProgressAside variant="desktop" items={progress} worst={published ? null : worst} onJump={(id) => goTo(sectionDomId(id))} />
        </div>
      </div>

      {/* 底部操作列：固定在捲動容器底部 */}
      {/* 右側留白讓出全站右下角的浮動客服按鈕，避免蓋住發布鈕 */}
      <div className="sticky bottom-0 z-10 border-t bg-background py-3 pl-4 pr-24 sm:pl-8 sm:pr-28">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => guard.navigate(LIST_HREF)} disabled={busy}>
            取消
          </Button>
          <div className="min-w-0 text-xs" aria-live="polite">
            {draftError ? (
              <span className="flex flex-wrap items-center gap-2 text-destructive" role="alert">
                {draftError}
                <Button type="button" variant="outline" size="sm" onClick={onSaveDraftClick} disabled={savingDraft}>
                  重試
                </Button>
              </span>
            ) : barError ? (
              <span className="text-destructive" role="alert">
                {barError}
              </span>
            ) : draftAt ? (
              <span className="text-muted-foreground">
                已儲存草稿 · <span className="font-mono">{draftAt}</span>
              </span>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {errorKeys.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAttempted(true);
                  goTo(fieldDomId(errorKeys[0]));
                }}
                title={errorKeys.map((k) => FIELD_LABEL[k]).join('、')}
                className="text-sm font-medium text-destructive underline underline-offset-2"
              >
                {errorKeys.length} 個欄位有誤
              </button>
            )}
            {missing.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAttempted(true);
                  goTo(missing[0].target);
                }}
                title={missing.map((m) => m.label).join('、')}
                className="text-sm font-medium text-warning underline underline-offset-2"
              >
                尚有 {missing.length} 個必填欄位
              </button>
            ) : (
              <span className="text-sm font-medium text-success">必填欄位已完成</span>
            )}
            {!published && (
              <Button type="button" variant="outline" onClick={onSaveDraftClick} disabled={busy}>
                {savingDraft ? '儲存中…' : '儲存草稿'}
              </Button>
            )}
            {published ? (
              <Button type="button" onClick={onSaveChangesClick} disabled={busy}>
                {savingChanges ? '儲存中…' : '儲存變更'}
              </Button>
            ) : (
              <Button type="button" onClick={onPublishClick} disabled={busy}>
                發布優惠券
              </Button>
            )}
          </div>
        </div>
      </div>

      <PublishConfirmDialog
        open={confirmOpen}
        rows={confirmRows}
        pinLine={pinLine}
        pinEmphasis={pinEmphasis}
        risks={riskList}
        worst={worst ?? { cost: '—', formula: '', note: '', bounded: true }}
        ack={ack}
        onAckChange={setAck}
        phase={phase}
        failMessage={failMessage}
        onConfirm={doPublish}
        onCancel={closeConfirm}
        onFix={fixRisk}
      />
      <LeaveConfirmDialog
        open={guard.open}
        published={published}
        saving={savingDraft || savingChanges}
        onStay={guard.stay}
        onDiscard={guard.leave}
        onSave={onLeaveSave}
      />
      <CouponToast toast={toast} />
    </div>
  );

  // ---- 各區塊內容 ----
  function renderSection(sec: SectionId): React.ReactNode {
    const wrap = (children: React.ReactNode, key?: string) => (
      <div key={key} className="flex flex-col gap-3.5 px-5 py-[18px]">
        {children}
      </div>
    );
    switch (sec) {
      case 'basic':
        return wrap(
          <>
            <TextField
              {...fp('name')}
              placeholder="例如：秋季家電 85 折券"
              maxLength={MAX_NAME}
              counter={`剩 ${Math.max(0, MAX_NAME - values.name.length)} 字`}
            />
            <FieldShell id={fieldDomId('terms')} label="使用條款" help="一行一條，顯示於券詳情頁">
              {(a11y) => (
                <Textarea
                  {...a11y}
                  value={values.terms}
                  onChange={(e) => setVal('terms', e.target.value)}
                  placeholder={'一行一條，例如：\n限直營門市使用\n不得與其他優惠併用'}
                  className="min-h-[92px] resize-y"
                />
              )}
            </FieldShell>
            <CoverImageField id={fieldDomId('imageUrl')} value={values.imageUrl} onChange={(url) => setVal('imageUrl', url)} />
          </>,
        );

      case 'type': {
        const t = values.couponType;
        const lockedT = isLocked(mode, 'couponType');
        return [
          wrap(
            <>
              {group('couponType')}
              {t && (
                <OptionPanel>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {t === 'DISCOUNT_AMOUNT' && (
                      <>
                        <TextField {...fp('discountAmount')} prefix="NT$" placeholder="例如 100" inputMode="numeric" />
                        <TextField
                          {...fp('minSpend')}
                          prefix="NT$"
                          placeholder="例如 1000"
                          inputMode="numeric"
                          help="0 表示不限"
                          tag={!lockedT && values.minSpend === '0' ? '預設' : undefined}
                        />
                      </>
                    )}
                    {t === 'DISCOUNT_PERCENT' && (
                      <>
                        <TextField {...fp('discountPercent')} suffix="%" placeholder="例如 15" inputMode="numeric" help="輸入 1–99" info={percentHint(values) || undefined} />
                        <TextField {...fp('percentCap')} prefix="NT$" placeholder="例如 300" inputMode="numeric" help="留空表示不設上限" />
                      </>
                    )}
                    {t === 'GIFT' && (
                      <>
                        <TextField {...fp('giftName')} placeholder="例如：電鍋專用蒸架" maxLength={50} />
                        <TextField {...fp('giftQty')} suffix="份" placeholder="例如 1" inputMode="numeric" />
                      </>
                    )}
                    {t === 'EXCHANGE' && (
                      <>
                        <TextField {...fp('exchangeItem')} placeholder="例如：冷氣免費清洗一次" maxLength={50} />
                        <TextField {...fp('exchangeValueCap')} prefix="NT$" placeholder="例如 1500" inputMode="numeric" help="留空表示不設上限" />
                      </>
                    )}
                  </div>
                </OptionPanel>
              )}
            </>,
            'type',
          ),
          wrap(
            <>
              {group('purpose')}
              {values.purpose === 'SERVICE' && <Note>發放紀錄計入客服補償報表。</Note>}
              {values.purpose === 'MARKETING' && <Note>成效計入行銷報表。</Note>}
            </>,
            'purpose',
          ),
        ];
      }

      case 'validity': {
        const m = values.validityMode;
        return wrap(
          <>
            {group('validityMode')}
            {m && (
              <OptionPanel>
                {m === 'FIXED' && (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <TextField {...fp('startAt')} type="date" min={published ? undefined : today} />
                      <TextField {...fp('endAt')} type="date" min={values.startAt || undefined} />
                    </div>
                    <Note>所有人的券在同一天到期，適合檔期活動。</Note>
                  </>
                )}
                {m === 'AFTER_CLAIM' && (
                  <>
                    <TextField {...fp('afterClaimDays')} suffix="天" placeholder="例如 30" inputMode="numeric" width="narrow" help="自領取當下起算，至少 1 天" />
                    <Note>每個人的到期日不同，適合長期發放的入會禮。</Note>
                  </>
                )}
                {m === 'AFTER_OPEN' && (
                  <>
                    <TextField {...fp('afterOpenMinutes')} suffix="分鐘" placeholder="例如 15" inputMode="numeric" width="narrow" help="自顧客點開券起算，至少 1 分鐘" />
                    <Note>顧客開啟後須在 N 分鐘內使用，適合現場活動；倒數結束後即無法使用。</Note>
                  </>
                )}
              </OptionPanel>
            )}
          </>,
        );
      }

      case 'code': {
        const m = values.codeMode;
        const sharedWarn = sharedNote?.warn && sharedNote.code === values.sharedCode.trim().toUpperCase() ? sharedNote.warn : undefined;
        return wrap(
          <>
            {group('codeMode')}
            {m && (
              <OptionPanel>
                {m === 'UNIQUE_CODE' && (
                  <>
                    <TextField
                      {...fp('codePrefix')}
                      onChange={(v) => setVal('codePrefix', v.toUpperCase())}
                      placeholder="例如 AUTUMN"
                      mono
                      maxLength={PREFIX_MAX}
                    />
                    <Note>
                      產生格式如 <span className="font-mono">{(values.codePrefix || 'AUTUMN').toUpperCase()}-7K2P-4M9X</span>，每人不同，可精準追蹤到個人。
                    </Note>
                  </>
                )}
                {m === 'SHARED_CODE' && (
                  <>
                    <TextField
                      {...fp('sharedCode')}
                      onChange={(v) => {
                        setVal('sharedCode', v.toUpperCase());
                        setSharedNote(null);
                      }}
                      onBlur={checkShared}
                      placeholder="例如 AUTUMN85"
                      mono
                      maxLength={20}
                      help="限英數字，4–20 字"
                      warn={sharedWarn}
                    />
                    <Note tone="caution" title="取捨提醒">
                      所有人拿到同一組碼，好處是簡單、可印在文宣上；代價是無法追蹤到個人，也擋不住轉發。
                      {values.purpose === 'MARKETING' && '共用碼可能在網路上流傳，建議搭配發行總量上限。'}
                    </Note>
                  </>
                )}
                {m === 'IMPORTED_CODES' &&
                  (isLocked(mode, 'codes') ? (
                    <p className="text-sm text-muted-foreground">序號包已匯入，優惠券發布後無法修改。</p>
                  ) : (
                    <>
                      <CodeImportField
                        id={fieldDomId('codes')}
                        state={importState}
                        onChange={(s) => {
                          importedBatches.current = 0;
                          setImportState(s);
                          markTouched('codes');
                        }}
                        ensureCouponId={ensureCouponId}
                        missing={attempted && missingKeys.has('codes')}
                        warn={warns.codes}
                      />
                      <Note>配合電商既有折扣碼庫，核銷狀態由電商系統同步，或定期對帳更新。</Note>
                    </>
                  ))}
              </OptionPanel>
            )}
          </>,
        );
      }

      case 'issue':
        return wrap(
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField {...fp('totalLimit')} suffix="張" placeholder="例如 5000" inputMode="numeric" help="留空表示不限" />
            <TextField {...fp('perContactLimit')} suffix="張" placeholder="例如 1" inputMode="numeric" help="至少 1 張，不能大於發行總量" />
          </div>,
        );

      case 'redeem': {
        const m = values.redeemMode;
        return wrap(
          <>
            {group('redeemMode')}
            {m && (
              <OptionPanel>
                {m === 'STAFF_CODE' && (
                  <TextField
                    {...fp('staffCode')}
                    // 只收數字、最多 6 位；以字串保存，開頭的 0 不會被去掉
                    onChange={(v) => setVal('staffCode', v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="例如 582917"
                    mono
                    inputMode="numeric"
                    maxLength={6}
                    width="pin"
                    desc="同一張優惠券發出的所有序號共用此驗證碼，店員在顧客手機上輸入完成核銷"
                    help="4–6 位數字"
                  />
                )}
                {m === 'STAFF_SCAN' && <Note>顧客券詳情顯示一次性 QR Code，顧客無法自行核銷，適合高價值券。</Note>}
                {m === 'SELF' && (
                  <>
                    <Note>顧客在券詳情滑動確認即可核銷，不需店員參與。</Note>
                    {highValueRisk && (
                      <Note tone="warn" title="高金額搭配顧客自助">
                        {highValueRisk.text}發布前需要再次確認。
                      </Note>
                    )}
                    <Note
                      tone="warn"
                      title="請注意此模式的代價"
                      action={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={termsHasSelfLine}
                          onClick={() => {
                            const t = values.terms.replace(/\s+$/, '');
                            setVal('terms', `${t ? `${t}\n` : ''}${TERMS_SELF_REDEEM_LINE}`);
                          }}
                        >
                          {termsHasSelfLine ? '已帶入使用條款' : '帶入使用條款'}
                        </Button>
                      }
                    >
                      顧客可自行核銷，無法歸因到店員。建議在使用條款中揭露「誤按即失效」。
                    </Note>
                    <Note>適合：無人商店、線上折扣碼、低價值券、活動快閃。</Note>
                  </>
                )}
              </OptionPanel>
            )}
          </>,
        );
      }

      case 'guard':
        return wrap(
          <>
            <CheckRow
              id="coupon-f-maskCodeBeforeStart"
              label="未到生效日不顯示序號"
              help="生效前只顯示使用規則，避免序號提前流出。"
              checked={values.maskCodeBeforeStart}
              onChange={(c) => setVal('maskCodeBeforeStart', c)}
            />
            <CheckRow
              id="coupon-f-autoTag"
              label="領券自動貼標"
              help="領取時自動為聯絡人貼上指定標籤，可直接用於分眾再行銷"
              checked={values.autoTag}
              onChange={(c) => setVal('autoTag', c)}
            />
            {values.autoTag && (
              <div className="ml-7 flex flex-col gap-3.5 rounded-lg border border-l-[3px] border-l-primary bg-muted/40 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">標籤設定</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <FieldShell
                    id={fieldDomId('claimTagId')}
                    label="標籤"
                    required
                    error={shownError('claimTagId')}
                    help={!tagsLoading && tags.length === 0 ? '尚無聯絡人標籤，請先到設定建立標籤' : undefined}
                  >
                    {(a11y) => (
                      <select
                        {...a11y}
                        aria-required="true"
                        value={values.claimTagId}
                        onChange={(e) => setVal('claimTagId', e.target.value)}
                        className={cn(
                          'h-10 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30',
                          shownError('claimTagId') ? 'border-destructive' : 'border-input',
                          !values.claimTagId && 'text-muted-foreground',
                        )}
                      >
                        <option value="">{tagsLoading ? '載入中…' : '選擇標籤'}</option>
                        {tags.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </FieldShell>
                  <TextField {...fp('claimTagTtlDays')} suffix="天後自動移除" inputMode="numeric" width="narrow" />
                </div>
              </div>
            )}
          </>,
        );
    }
  }
}

function CheckRow({ id, label, help, checked, onChange }: { id: string; label: string; help: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-foreground">
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  );
}
