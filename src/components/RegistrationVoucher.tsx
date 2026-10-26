'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, CheckCircle2, Copy, Check, Download, Share2, ShieldCheck, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Registration, Athlete, Event, AppLocale } from '@/types';
import { formatMoney } from '@/lib/intl/format';
import { isShirtNone } from '@/lib/shirtPricing';
import { toBcp47 } from '@/i18n/locales';
import {
  getEventDateLabel,
  getEventInitials,
  getPaymentMethodKind,
  isPosterEligible,
  toInstagramHandle
} from '@/lib/registrationPoster';

interface RegistrationVoucherProps {
  registration: Registration;
  athlete: Athlete;
  event: Event;
  onClose: () => void;
}

type PosterState = 'loading' | 'ready' | 'error';
type VoucherTab = 'front' | 'back';

// Comprovante único (Story 1.74): a frente é a imagem para os Stories (pôster 1B,
// gerada no servidor) e o verso tem o registro completo. É o mesmo componente no
// sucesso da inscrição, no painel do gestor e na área do atleta.
export function RegistrationVoucher({
  registration,
  athlete,
  event,
  onClose
}: RegistrationVoucherProps) {
  const t = useTranslations('Voucher');
  const locale = useLocale() as AppLocale;

  const hasFront = isPosterEligible(registration);
  const [tab, setTab] = useState<VoucherTab>(hasFront ? 'front' : 'back');
  const [posterState, setPosterState] = useState<PosterState>('loading');
  const [posterBlob, setPosterBlob] = useState<Blob | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const posterPath = `/api/registrations/${encodeURIComponent(registration.id)}/poster?format=story${
    registration.accessToken ? `&access_token=${encodeURIComponent(registration.accessToken)}` : ''
  }`;

  useEffect(() => {
    if (!hasFront) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    fetch(posterPath, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPosterBlob(blob);
        setPosterUrl(objectUrl);
        setPosterState('ready');
      })
      .catch(() => {
        if (!cancelled) setPosterState('error');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasFront, posterPath]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const fileName = `inscricao-wodarena-${registration.id.replace(/^reg-/, '').slice(0, 8)}.png`;

  const handleSave = () => {
    if (!posterUrl) return;
    setActionError(false);
    const link = document.createElement('a');
    link.href = posterUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const canShareFile = typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && typeof File !== 'undefined';

  const handleShare = async () => {
    if (!posterBlob) return;
    setActionError(false);
    try {
      const file = new File([posterBlob], fileName, { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) {
        handleSave();
        return;
      }
      await navigator.share({ files: [file], title: event.name });
    } catch (err) {
      // Fechar a folha de compartilhamento não é erro.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setActionError(true);
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(registration.id);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 2000);
    } catch {
      setIdCopied(false);
    }
  };

  const createdAtDate = registration.createdAt ? new Date(registration.createdAt) : null;
  const formattedIssueDate = createdAtDate && !Number.isNaN(createdAtDate.getTime())
    ? new Intl.DateTimeFormat(toBcp47(locale), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(createdAtDate)
    : '';

  const currency = registration.currency ?? 'BRL';
  const formattedPrice = formatMoney(registration.totalPaid, currency, locale);

  const teamMemberList = athlete.isTeam ? athlete.teamMembers ?? [] : [];
  const teamMembers = teamMemberList.map(member => member.name).join(' / ');

  // Camisa por participante, na ordem da inscrição, e o adicional cobrado
  // (Story 1.38). A linha só aparece quando a camisa foi opcional (adicional pago
  // ou "Sem camisa"): inscrições de camisa inclusa ficam como antes da story.
  const shirtSizes = (teamMemberList.length > 0 ? teamMemberList.map(member => member.shirtSize) : [athlete.shirtSize])
    .map(size => String(size || '').trim());
  const shirtAddonAmount = registration.shirtAddonAmount ?? 0;
  const hasOptionalShirtChoice = shirtAddonAmount > 0 || shirtSizes.some(isShirtNone);
  const shirtSummary = hasOptionalShirtChoice
    ? [
        shirtSizes.some(Boolean)
          ? shirtSizes.map(size => (isShirtNone(size) ? t('shirtNone') : size || '—')).join(' · ')
          : '',
        shirtAddonAmount > 0 ? t('shirtAddon', { amount: formatMoney(shirtAddonAmount, currency, locale) }) : ''
      ].filter(Boolean).join(' · ')
    : '';

  const hasLogo = Boolean(event.logoUrl);
  const paymentStatus = registration.paymentStatus || 'payment_approved';
  const isPaymentApproved = paymentStatus === 'payment_approved';
  const statusLabel = paymentStatus === 'payment_failed'
    ? t('statusFailed')
    : paymentStatus === 'payment_in_review'
      ? t('statusInReview')
      : paymentStatus === 'payment_cancelled'
        ? t('statusCancelled')
        : paymentStatus === 'payment_pending'
          ? t('statusPending')
          : t('statusApproved');
  const StatusIcon = isPaymentApproved ? CheckCircle2 : AlertTriangle;

  const methodKind = getPaymentMethodKind(registration.paymentMethod);
  const methodLabel = methodKind === 'free'
    ? t('methodFree')
    : methodKind === 'pix'
      ? t('methodPix')
      : methodKind === 'card'
        ? t('methodCard')
        : '';
  const paymentSummary = [methodLabel, statusLabel].filter(Boolean).join(' · ');

  const dateLabel = getEventDateLabel(event, locale);
  const eventPlace = [event.location, [event.city, event.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const eventSubtitle = [dateLabel, eventPlace].filter(Boolean).join(' · ');
  const instagramHandle = toInstagramHandle(event.instagram);

  const tabs: { id: VoucherTab; label: string }[] = [
    { id: 'front', label: t('tabFront') },
    { id: 'back', label: t('tabBack') }
  ];

  return (
    <div
      id="registration-voucher-overlay"
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#0b0e11]/95 px-3 py-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogAriaLabel')}
    >
      <div className="w-full max-w-[430px] space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-[#2b3139] bg-[#1e2329] px-3 py-2 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <StatusIcon className={`h-4 w-4 shrink-0 ${isPaymentApproved ? 'text-[#0ecb81]' : 'text-[#FCD535]'}`} aria-hidden="true" />
            <span className="truncate text-xs font-bold uppercase">{statusLabel}</span>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#929aa5] transition-colors hover:bg-[#2b3139] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
            aria-label={t('closeAria')}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {hasFront && (
          <div role="tablist" aria-label={t('dialogAriaLabel')} className="grid grid-cols-2 rounded-lg border border-[#2b3139] bg-[#1e2329] p-1 text-xs font-bold uppercase">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                id={`voucher-tab-${id}`}
                role="tab"
                type="button"
                aria-selected={tab === id}
                aria-controls={`voucher-panel-${id}`}
                onClick={() => setTab(id)}
                className={`min-h-11 rounded-md px-3 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50 ${
                  tab === id ? 'bg-[#2b3139] text-white' : 'text-[#929aa5] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {hasFront && tab === 'front' && (
          <div id="voucher-panel-front" role="tabpanel" aria-labelledby="voucher-tab-front" className="space-y-3">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl border border-[#2b3139] bg-[#1e2329]">
              {posterState === 'ready' && posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- blob: gerado no navegador
                <img src={posterUrl} alt={t('posterAlt', { name: registration.athleteName })} className="h-full w-full object-cover" />
              )}
              {posterState === 'loading' && (
                <div className="flex h-full w-full animate-pulse items-center justify-center bg-[#FCD535]/20 px-6 text-center text-xs font-bold uppercase text-[#929aa5]" role="status">
                  {t('posterLoading')}
                </div>
              )}
              {posterState === 'error' && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
                  <AlertTriangle className="h-6 w-6 text-[#FCD535]" aria-hidden="true" />
                  <p className="text-xs leading-relaxed text-[#929aa5]">{t('posterError')}</p>
                  <button
                    type="button"
                    onClick={() => setTab('back')}
                    className="min-h-11 rounded-md border border-[#2b3139] bg-[#0b0e11] px-4 text-xs font-bold uppercase text-white hover:border-[#FCD535]/50"
                  >
                    {t('tabBack')}
                  </button>
                </div>
              )}
            </div>
            {actionError && (
              <p className="text-center text-xs text-[#f6465d]" role="alert">{t('actionError')}</p>
            )}
            <div className={`grid gap-3 ${canShareFile ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <button
                type="button"
                onClick={handleSave}
                disabled={posterState !== 'ready'}
                className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#FCD535] px-4 py-2 text-xs font-bold uppercase text-[#181a20] transition-colors hover:bg-[#f0b90b] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('saveImage')}
              </button>
              {canShareFile && (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={posterState !== 'ready'}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:border-[#FCD535]/50 hover:text-[#FCD535] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  {t('shareImage')}
                </button>
              )}
            </div>
            <p className="text-center text-[11px] leading-relaxed text-[#929aa5]">
              {instagramHandle ? t('tagReminder', { handle: instagramHandle }) : t('tagReminderGeneric')}
            </p>
          </div>
        )}

        {tab === 'back' && (
          <div id="voucher-panel-back" role={hasFront ? 'tabpanel' : undefined} aria-labelledby={hasFront ? 'voucher-tab-back' : undefined} className="space-y-3">
            <article className="relative overflow-hidden rounded-xl border border-[#2b3139] bg-[#0b0e11] text-white">
              <div className="absolute inset-x-0 top-0 h-1.5 bg-[#FCD535]" aria-hidden="true" />
              <header className="flex items-center gap-3 border-b border-[#2b3139] px-5 pb-4 pt-6">
                {hasLogo ? (
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-[#2b3139] bg-white p-1">
                    <Image
                      src={event.logoUrl}
                      alt={`${event.name} logo`}
                      width={44}
                      height={44}
                      unoptimized
                      className="h-full w-full rounded object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#FCD535] text-sm font-black text-[#181a20]">
                    {getEventInitials(event.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-black uppercase leading-tight">{event.name}</h2>
                  {eventSubtitle && <p className="mt-1 text-[11px] leading-snug text-[#929aa5]">{eventSubtitle}</p>}
                </div>
              </header>

              <section className="divide-y divide-[#1e2329]">
                <VoucherInfo label={t('athleteLabel')} value={registration.athleteName} strong>
                  {teamMembers && <p className="mt-1 text-xs font-medium leading-relaxed text-[#929aa5]">{t('membersLabel', { names: teamMembers })}</p>}
                </VoucherInfo>
                <VoucherInfo label={t('categoryLabel')} value={registration.ticketType} />
                <VoucherInfo label={t('boxLabel')} value={registration.box || t('boxFallback')} />
                {shirtSummary && (
                  <VoucherInfo label={t('shirtLabel')} value={shirtSummary} />
                )}
                <VoucherInfo label={t('amountPaidLabel')} value={formattedPrice} highlight />
                <VoucherInfo label={t('paymentLabel')} value={paymentSummary} />
                {formattedIssueDate && <VoucherInfo label={t('issuedLabel')} value={formattedIssueDate} />}
                <VoucherInfo label={t('idLabel')} value={registration.id} mono>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-3 text-[11px] font-bold uppercase text-white transition-colors hover:border-[#FCD535]/50 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
                  >
                    {idCopied ? <Check className="h-3.5 w-3.5 text-[#0ecb81]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {idCopied ? t('idCopied') : t('copyId')}
                  </button>
                </VoucherInfo>
              </section>

              <footer className="space-y-3 border-t border-[#2b3139] bg-[#0b0e11] px-5 py-5">
                <div className="flex items-start gap-3 rounded-lg border border-[#2b3139] bg-[#1e2329] p-4">
                  {isPaymentApproved ? (
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0ecb81]" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#FCD535]" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-xs font-bold uppercase text-white">{isPaymentApproved ? t('validatedTitle') : t('registeredTitle')}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#929aa5]">
                      {isPaymentApproved ? t('validatedDescription') : t('registeredDescription')}
                    </p>
                  </div>
                </div>
                {instagramHandle && (
                  <p className="text-[11px] leading-relaxed text-[#929aa5]">{t('organizerContact', { handle: instagramHandle })}</p>
                )}
              </footer>
            </article>
          </div>
        )}

        <button
          onClick={onClose}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:border-[#FCD535]/50 hover:text-[#FCD535] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/50"
          type="button"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {t('done')}
        </button>
      </div>
    </div>
  );
}

function VoucherInfo({
  label,
  value,
  strong = false,
  highlight = false,
  mono = false,
  children
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#929aa5]">{label}</p>
      <p
        className={`mt-1 break-words leading-snug ${
          highlight ? 'font-number text-lg font-black text-[#FCD535]' : strong ? 'text-base font-black uppercase' : 'text-sm font-bold'
        } ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </p>
      {children}
    </div>
  );
}
