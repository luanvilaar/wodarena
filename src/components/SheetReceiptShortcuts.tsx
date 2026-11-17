'use client';

import { useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';

import type { AthleteReceiptItem, AthleteReceiptRegistration, SheetReceipt, SheetReceiptState } from '@/lib/sheetReceipt';

// Onde o comprovante de envio da súmula aparece (Story 1.146; plano aprovado em
// docs/design/comprovante-sumula/, decisão D1): o resumo na Quadra logo depois
// do envio e a lista no cartão da inscrição, na Área do Atleta. Cada um tem a
// parte de exibição (testável sem rede) e a que busca os dados em
// /api/sheet-receipts. O painel do gestor (D8) fica no ScoresheetsPanel.

const PILL: Record<SheetReceiptState, string> = {
  published: 'border-trading-up/60 text-trading-up',
  corrected: 'border-primary/60 text-primary',
  manual: 'border-primary/60 text-primary',
  returned: 'border-trading-down/60 text-trading-down',
  absent: 'border-info/60 text-info',
  cancelled: 'border-trading-down/60 text-trading-down'
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o comprovante.');
  return data;
};

// ---------------------------------------------------------------------------
// Quadra
// ---------------------------------------------------------------------------

/** Resumo do comprovante na Quadra (tema claro de alto contraste, pelas cores da classe court-light). */
export function CourtReceiptSummary({ receipt, path }: { receipt: SheetReceipt; path: string }) {
  const { heat } = receipt;
  const heatText = heat.number ? `${heat.number}${heat.lane ? ` · Raia ${heat.lane}` : ''}${heat.scheduled ? ` · ${heat.scheduled.split(', ').pop()}` : ''}` : 'Sem bateria';
  return (
    <section className="space-y-3 rounded-2xl border border-card-border bg-card p-4" aria-labelledby="court-receipt-title">
      <h2 id="court-receipt-title" className="text-[11px] font-bold uppercase tracking-widest text-muted">Comprovante do atleta</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Atleta</dt>
        <dd className="truncate text-right font-bold">{receipt.athlete.name}</dd>
        <dt className="text-muted">Bateria</dt>
        <dd className="text-right font-number font-bold">{heatText}</dd>
        <dt className="text-muted">Árbitro</dt>
        <dd className="truncate text-right font-bold">{receipt.judgeName || 'Não informado'}</dd>
        <dt className="text-muted">{receipt.sentLabel}</dt>
        <dd className="text-right font-number font-bold">{receipt.sentAt}</dd>
      </dl>
      <p className="text-xs text-muted">O atleta encontra este comprovante na Área do Atleta, em Inscrições.</p>
      <a href={path} target="_blank" rel="noopener" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-card-border bg-background text-sm font-extrabold uppercase tracking-wide">
        <ReceiptText className="h-4 w-4" aria-hidden="true" />Ver comprovante
      </a>
    </section>
  );
}

/** Busca o comprovante da súmula recém-enviada. `refreshKey` muda quando o resultado publicado muda. */
export function CourtSheetReceipt({ sheetId, refreshKey }: { sheetId: string; refreshKey: string }) {
  const [state, setState] = useState<{ key: string; receipt: SheetReceipt | null; path: string; error: string }>({ key: '', receipt: null, path: '', error: '' });
  const key = `${sheetId}|${refreshKey}`;

  useEffect(() => {
    let active = true;
    fetchJson(`/api/sheet-receipts?sheetId=${encodeURIComponent(sheetId)}`)
      .then((data) => { if (active) setState({ key, receipt: data.receipt, path: data.path, error: '' }); })
      .catch((error) => { if (active) setState({ key, receipt: null, path: '', error: error instanceof Error ? error.message : 'Comprovante indisponível agora.' }); });
    return () => { active = false; };
  }, [key, sheetId]);

  if (state.key !== key) return <p className="text-xs text-muted" role="status">Carregando o comprovante…</p>;
  if (!state.receipt) return <p className="text-xs text-muted">Comprovante indisponível agora. {state.error}</p>;
  return <CourtReceiptSummary receipt={state.receipt} path={state.path} />;
}

// ---------------------------------------------------------------------------
// Área do Atleta
// ---------------------------------------------------------------------------

/** "Comprovantes das provas" no cartão da inscrição. Sem prova com súmula digital, nada aparece. */
export function AthleteSheetReceiptList({ provas }: { provas: AthleteReceiptItem[] }) {
  if (provas.length === 0) return null;
  return (
    <section className="mt-3 space-y-1 border-t border-card-border pt-3" aria-label="Comprovantes das provas">
      <h5 className="text-[11px] font-bold uppercase tracking-widest text-muted">Comprovantes das provas</h5>
      <ul className="divide-y divide-card-border">
        {provas.map((prova) => {
          const receipt = prova.receipt;
          const where = receipt
            ? [receipt.heatNumber ? `Bateria ${receipt.heatNumber}${receipt.lane ? ` · Raia ${receipt.lane}` : ''}` : 'Sem bateria', receipt.judgeName ? `Árbitro ${receipt.judgeName}` : ''].filter(Boolean).join(' · ')
            : 'Súmula ainda não enviada';
          return (
            <li key={prova.workoutId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{prova.code}</p>
                <p className="text-xs text-muted">{where}</p>
              </div>
              <div className="flex items-center gap-2">
                {receipt ? (
                  <>
                    <span className={`font-number text-sm font-bold ${receipt.struck ? 'text-muted line-through' : 'text-white'}`}>{receipt.result}</span>
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PILL[receipt.state]}`}>{receipt.stateLabel}</span>
                    <a
                      href={receipt.path}
                      aria-label={`Ver comprovante da ${prova.code}`}
                      className="inline-flex min-h-9 items-center rounded-md border border-card-border bg-dark-gray px-3 text-[11px] font-bold uppercase tracking-wider text-white hover:border-primary"
                    >
                      Ver
                    </a>
                  </>
                ) : (
                  <span className="whitespace-nowrap rounded-full border border-card-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">Aguardando</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Busca os comprovantes de uma inscrição do atleta logado. */
export function AthleteSheetReceipts({ registrationId }: { registrationId: string }) {
  const [state, setState] = useState<{ id: string; provas: AthleteReceiptItem[]; error: string }>({ id: '', provas: [], error: '' });

  useEffect(() => {
    let active = true;
    fetchJson(`/api/sheet-receipts?view=mine&registrationId=${encodeURIComponent(registrationId)}`)
      .then((data) => {
        const registration = ((data.registrations || []) as AthleteReceiptRegistration[]).find((item) => item.registrationId === registrationId);
        if (active) setState({ id: registrationId, provas: registration?.provas ?? [], error: '' });
      })
      .catch(() => { if (active) setState({ id: registrationId, provas: [], error: 'Não foi possível carregar os comprovantes das provas.' }); });
    return () => { active = false; };
  }, [registrationId]);

  if (state.id !== registrationId) return null;
  if (state.error) return <p className="mt-3 border-t border-card-border pt-3 text-xs text-muted">{state.error}</p>;
  return <AthleteSheetReceiptList provas={state.provas} />;
}
