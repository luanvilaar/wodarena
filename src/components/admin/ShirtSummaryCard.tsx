'use client';

import React, { useId } from 'react';

import { SHIRT_SIZES, type ShirtMode } from '@/lib/shirtPricing';
import { SHIRT_NONE_LABEL, type ShirtSummary } from '@/lib/shirtSummary';

type ShirtSummaryCardProps = {
  summary: ShirtSummary;
  shirtMode: ShirtMode;
  /** A lista está filtrada: o resumo conta só as inscrições visíveis. */
  isFiltered: boolean;
};

const plural = (count: number, singular: string, pluralText: string) => (count === 1 ? singular : pluralText);

/**
 * Resumo para o pedido ao fornecedor (Story 1.38, D5): camisas por tamanho das
 * inscrições pagas da lista atual. Pendentes aparecem à parte, fora da conta.
 */
export function ShirtSummaryCard({ summary, shirtMode, isFiltered }: ShirtSummaryCardProps) {
  const titleId = useId();
  const hasPaid = summary.paidRegistrations > 0;
  // "Sem camisa" só existe na camisa opcional; em evento de camisa inclusa o zero seria ruído.
  const showWithoutShirt = shirtMode === 'optional' || summary.withoutShirt > 0;

  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-lg border border-card-border bg-dark-gray/25 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h4 id={titleId} className="text-[10px] font-bold uppercase tracking-wider text-muted font-sans">
          Resumo para o pedido ao fornecedor
        </h4>
        <p className="text-[11px] text-muted">
          Conta só inscrições pagas.{isFiltered ? ' Considera os filtros da lista.' : ''}
        </p>
      </div>

      {hasPaid ? (
        <>
          <ul aria-label="Camisas pagas por tamanho" className="flex flex-wrap items-center gap-2">
            {SHIRT_SIZES.map(size => (
              <li
                key={size}
                className="inline-flex items-baseline gap-1.5 rounded-md border border-card-border bg-dark-gray px-2.5 py-1 font-number text-xs text-white"
              >
                <span className="sr-only">Tamanho </span>
                {size}
                <span className="sr-only">:</span>
                <span className="font-bold text-primary">{summary.sizes[size]}</span>
              </li>
            ))}
            {summary.otherSizes.map(({ size, count }) => (
              <li
                key={`other-${size}`}
                className="inline-flex items-baseline gap-1.5 rounded-md border border-card-border bg-dark-gray px-2.5 py-1 font-number text-xs text-white"
              >
                <span className="sr-only">Tamanho </span>
                {size}
                <span className="font-sans text-[10px] text-muted">(antigo)</span>
                <span className="sr-only">:</span>
                <span className="font-bold text-primary">{count}</span>
              </li>
            ))}
          </ul>

          <ul aria-label="Totais do pedido" className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <li className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-primary">
              <span className="font-number">{summary.totalToProduce}</span>{' '}
              {plural(summary.totalToProduce, 'camisa a produzir', 'camisas a produzir')}
            </li>
            {showWithoutShirt && (
              <li className="rounded-full border border-card-border px-2.5 py-0.5 text-muted-soft">
                <span className="font-number">{summary.withoutShirt}</span> {SHIRT_NONE_LABEL.toLowerCase()}
              </li>
            )}
            {summary.missingSize > 0 && (
              <li className="rounded-full border border-card-border px-2.5 py-0.5 text-muted-soft">
                <span className="font-number">{summary.missingSize}</span> sem tamanho informado
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted">
          {isFiltered
            ? 'Nenhuma inscrição paga com os filtros atuais.'
            : 'Nenhuma inscrição paga ainda. O resumo aparece quando houver pagamento aprovado.'}
        </p>
      )}

      {summary.pendingShirts > 0 && (
        <p className="text-[11px] text-muted">
          <span className="font-number">{summary.pendingShirts}</span>{' '}
          {plural(
            summary.pendingShirts,
            'camisa em inscrição pendente (não incluída)',
            'camisas em inscrições pendentes (não incluídas)'
          )}
        </p>
      )}
    </section>
  );
}
