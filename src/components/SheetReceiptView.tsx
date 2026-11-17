'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, Flag, Link2, ShieldCheck } from 'lucide-react';

import type { SheetReceipt, SheetReceiptState } from '@/lib/sheetReceipt';

// Comprovante de envio da súmula (Story 1.145; plano aprovado em
// docs/design/comprovante-sumula/). Visual do verso do comprovante de inscrição:
// faixa amarela, cabeçalho do evento e o selo de status no rodapé. O modelo vem
// pronto do servidor (sheetReceipt.ts); aqui só a exibição, copiar o link e o
// atalho para contestar na Área do Atleta (D7).

const PILL: Record<SheetReceiptState, string> = {
  published: 'border-trading-up/60 text-trading-up',
  corrected: 'border-primary/60 text-primary',
  manual: 'border-primary/60 text-primary',
  returned: 'border-trading-down/60 text-trading-down',
  absent: 'border-info/60 text-info',
  cancelled: 'border-trading-down/60 text-trading-down'
};

const SEAL_ICON: Record<SheetReceiptState, string> = {
  published: 'text-trading-up',
  corrected: 'text-primary',
  manual: 'text-primary',
  returned: 'text-trading-down',
  absent: 'text-info',
  cancelled: 'text-trading-down'
};

/** Atalho para a Área do Atleta, seção Contestações (D7). */
export const SHEET_RECEIPT_CONTEST_HREF = '/admin#contestar';

type Props = {
  receipt: SheetReceipt;
  /** Endereço copiado; sem ele, o da própria página. */
  shareUrl?: string;
};

export function SheetReceiptView({ receipt, shareUrl }: Props) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState('');
  const { event, workout, athlete, heat, result } = receipt;
  const showName = workout.name && workout.name.toLocaleUpperCase('pt-BR') !== workout.code.toLocaleUpperCase('pt-BR');

  const copyLink = async () => {
    const url = shareUrl || window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      setFallbackUrl(url);
      setCopy('failed');
      window.setTimeout(() => fallbackRef.current?.select(), 0);
    }
  };

  return (
    <article className="overflow-hidden rounded-xl border border-card-border bg-background text-white" aria-labelledby="sheet-receipt-title">
      <div className="h-1.5 bg-primary" aria-hidden="true" />
      <header className="flex items-center gap-3 border-b border-card-border px-5 pb-4 pt-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-black text-ink" aria-hidden="true">{event.initials}</div>
        <div className="min-w-0">
          <p className="break-words text-sm font-black uppercase leading-tight">{event.name}</p>
          {event.subtitle && <p className="mt-1 text-[11px] leading-snug text-muted">{event.subtitle}</p>}
        </div>
      </header>

      <section className="space-y-1 border-b border-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-primary">Comprovante de envio da súmula</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${PILL[receipt.state]}`}>{receipt.stateLabel}</span>
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted">
          {workout.code}{showName ? ` · ${workout.name}` : ''}{workout.format ? ` · ${workout.format}` : ''}
        </p>
        <h1 id="sheet-receipt-title" className="break-words text-xl font-black leading-tight">{athlete.name}</h1>
        {athlete.members && <p className="text-xs text-muted">{athlete.members}</p>}
        {(athlete.box || athlete.division) && <p className="text-xs text-muted">{[athlete.box, athlete.division].filter(Boolean).join(' · ')}</p>}
      </section>

      <section className="space-y-1.5 border-b border-card px-5 py-4" aria-label="Resultado">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">{result.official ? 'Resultado oficial' : 'Resultado'}</p>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`font-number text-5xl font-bold leading-none tracking-tight ${result.struck ? 'text-muted line-through' : ''}`}>{result.value}</span>
          {result.unit && <span className="text-sm font-semibold text-muted">{result.unit}</span>}
          {result.tieBreak && <span className="font-number text-xs text-muted">tie-break {result.tieBreak}</span>}
          {receipt.state === 'absent' && <span className="rounded-full border border-info/60 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-info">Ausente</span>}
        </p>
        {result.struck && <p className="text-xs text-muted">Este resultado não conta no ranking.</p>}
        {receipt.judgeResult && <p className="text-xs text-muted">Enviado pelo judge: <span className="font-number font-bold text-white">{receipt.judgeResult}</span></p>}
        {receipt.summary && <p className="text-xs text-muted">Na súmula do judge: {receipt.summary}</p>}
      </section>

      <section className="border-b border-card px-5 py-4" aria-label="Bateria e arbitragem">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Bateria</dt>
          <dd className="text-right font-number font-semibold">{heat.number ? `${heat.number}${heat.lane ? ` · Raia ${heat.lane}` : ''}` : 'Sem bateria no cronograma'}</dd>
          {heat.scheduled && (<><dt className="text-muted">Horário no cronograma</dt><dd className="text-right font-number font-semibold">{heat.scheduled}</dd></>)}
          <dt className="text-muted">Árbitro</dt>
          <dd className="text-right font-semibold">{receipt.judgeName || 'Não informado'}</dd>
          <dt className="text-muted">Súmula aberta</dt>
          <dd className="text-right font-number font-semibold">{receipt.openedAt}</dd>
          <dt className="text-muted">{receipt.sentLabel}</dt>
          <dd className="text-right font-number font-semibold">{receipt.sentAt}</dd>
        </dl>
      </section>

      {receipt.timeline.length > 0 && (
        <section className="space-y-2 border-b border-card px-5 py-4" aria-labelledby="sheet-receipt-timeline">
          <h2 id="sheet-receipt-timeline" className="text-xs font-bold uppercase tracking-wider text-muted">Linha do tempo</h2>
          <ol className="space-y-2 border-l border-card-border pl-3 text-xs text-muted">
            {receipt.timeline.map((item, index) => (
              <li key={`${item.at}-${index}`}>
                <span className="font-number">{item.at}</span> · <span className="font-semibold text-white">{item.label}</span>{item.detail ? ` ${item.detail}` : ''}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(workout.movements.length > 0 || workout.tieBreaker) && (
        <details className="group border-b border-card px-5 py-3">
          <summary className="flex min-h-9 cursor-pointer list-none items-center text-xs font-bold text-primary">Ver movimentos e desempate</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
            {workout.movements.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
            {workout.tieBreaker && <li>Desempate: {workout.tieBreaker}</li>}
          </ul>
        </details>
      )}

      <footer className="space-y-3 px-5 pb-5 pt-4">
        <div className="flex items-start gap-3 rounded-lg border border-card-border bg-card p-3 text-xs text-muted">
          {receipt.state === 'published'
            ? <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${SEAL_ICON[receipt.state]}`} aria-hidden="true" />
            : <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${SEAL_ICON[receipt.state]}`} aria-hidden="true" />}
          <div>
            <p className="text-[13px] font-bold text-white">{receipt.seal.title}</p>
            <p>{receipt.seal.text}</p>
          </div>
        </div>
        <p className="flex justify-between text-[11px] text-muted">
          <span>Código da súmula</span>
          <span className="font-number">{receipt.code}</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-card px-3 text-[11px] font-extrabold uppercase tracking-wider text-white transition-colors hover:border-primary/50 motion-reduce:transition-none"
          >
            {copy === 'copied' ? <Check className="h-4 w-4 text-trading-up" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {copy === 'copied' ? 'Link copiado' : 'Copiar link'}
          </button>
          <a
            href={SHEET_RECEIPT_CONTEST_HREF}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-extrabold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover motion-reduce:transition-none"
          >
            <Flag className="h-4 w-4" aria-hidden="true" />Contestar
          </a>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{copy === 'copied' ? 'Link do comprovante copiado.' : ''}</p>
        {copy === 'failed' && (
          <div className="space-y-1">
            <label htmlFor="sheet-receipt-link" className="block text-[11px] text-muted">Não deu para copiar sozinho. Copie o link abaixo:</label>
            <input id="sheet-receipt-link" ref={fallbackRef} readOnly value={fallbackUrl} onFocus={(focusEvent) => focusEvent.currentTarget.select()} className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 font-number text-xs text-white" />
          </div>
        )}
        <p className="text-center text-[11px] leading-relaxed text-muted">Este comprovante mostra o estado atual da súmula e muda se o resultado for corrigido ou cancelado. Para contestar, cite o código da súmula.</p>
      </footer>
    </article>
  );
}
