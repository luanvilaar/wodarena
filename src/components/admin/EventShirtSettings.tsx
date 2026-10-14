'use client';

import React from 'react';

import { formatMoney } from '@/lib/intl/format';
import {
  calculateRegistrationAmounts,
  getDivisionParticipantCount,
  validateShirtConfig,
  type ShirtMode
} from '@/lib/shirtPricing';
import type { Division, EventCurrency } from '@/types';

type ShirtPreviewDivision = Pick<Division, 'id' | 'name' | 'type' | 'price'>;

export type ShirtSettingsSaveResult =
  | { ok: true; mode: ShirtMode; price: number }
  | { ok: false; error: string };

type EventShirtSettingsProps = {
  /** Prefixo dos ids, para o cartão aparecer em mais de um formulário. */
  idPrefix: string;
  mode: ShirtMode;
  /** Texto do campo; vazio quando o gestor ainda não informou o adicional. */
  price: string;
  onModeChange: (mode: ShirtMode) => void;
  onPriceChange: (price: string) => void;
  priceInputRef?: React.Ref<HTMLInputElement>;
  currency?: EventCurrency;
  /** Categorias para a prévia. Ausente no novo evento, que ainda não tem categorias. */
  divisions?: ShirtPreviewDivision[];
  /** Inscrições não canceladas do evento. Ausente no novo evento. */
  existingRegistrations?: number;
};

const MODE_OPTIONS: { value: ShirtMode; label: string; description: string }[] = [
  {
    value: 'included',
    label: 'Camisa inclusa no valor',
    description: 'Todos recebem camisa e escolhem o tamanho (P, M, G ou GG). É como funciona hoje.'
  },
  {
    value: 'optional',
    label: 'Camisa opcional com adicional',
    description: 'O atleta escolhe o tamanho ou “Sem camisa”. Quem quiser a camisa paga o valor adicional.'
  }
];

const formatEventMoney = (amount: number, currency: EventCurrency) => formatMoney(amount, currency, 'pt-br');

const getCurrencySymbol = (currency: EventCurrency) => (
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency })
    .formatToParts(0)
    .find(part => part.type === 'currency')?.value || currency
);

/** Valor do campo a partir do adicional salvo; zero vira campo vazio. */
export const toShirtPriceInput = (price?: number) => (price && price > 0 ? String(price) : '');

/**
 * Configuração enviada ao salvar o evento, pela mesma validação do servidor.
 * No modo "inclusa" o adicional segue no payload para o gestor reencontrá-lo
 * ao voltar ao modo opcional; como o campo fica desabilitado, um valor
 * inválido nele não pode travar o salvamento e volta ao último valor salvo.
 */
export const resolveShirtSettingsForSave = (
  mode: ShirtMode,
  priceInput: string,
  savedPrice = 0
): ShirtSettingsSaveResult => {
  // Campo vazio em "inclusa" (apagado em "opcional" antes de voltar) valeria 0
  // e zeraria o adicional guardado; reenvia o último valor salvo.
  if (mode === 'included' && !priceInput.trim()) return { ok: true, mode, price: savedPrice };
  const config = validateShirtConfig({ mode, price: priceInput });
  if (config.ok) return config;
  if (mode === 'included') return { ok: true, mode, price: savedPrice };
  return config;
};

/**
 * Quanto o atleta paga na categoria sem camisa e com camisa para todos os
 * integrantes, pela mesma conta do servidor (centavos e cobrança mínima).
 */
export const getDivisionShirtPrices = (division: Pick<Division, 'type' | 'price'>, shirtAddonPrice: number) => {
  const totalFor = (shirtAddonCount: number) => calculateRegistrationAmounts({
    ticketPrice: division.price,
    quantity: 1,
    discount: 0,
    shirtMode: 'optional',
    shirtAddonPrice,
    shirtAddonCount
  }).totalPaid;

  return {
    withoutShirt: totalFor(0),
    withShirt: totalFor(getDivisionParticipantCount(division.type))
  };
};

export function EventShirtSettings({
  idPrefix,
  mode,
  price,
  onModeChange,
  onPriceChange,
  priceInputRef,
  currency = 'BRL',
  divisions,
  existingRegistrations
}: EventShirtSettingsProps) {
  const isOptional = mode === 'optional';
  const titleId = `${idPrefix}-shirt-title`;
  const priceId = `${idPrefix}-shirt-addon-price`;
  const priceErrorId = `${priceId}-error`;
  const priceHintId = `${priceId}-hint`;
  const previewTitleId = `${idPrefix}-shirt-preview-title`;

  const config = validateShirtConfig({ mode, price });
  const priceError = isOptional && !config.ok ? config.error : '';
  const addonPrice = isOptional && config.ok ? config.price : null;
  const hasTeams = (divisions || []).some(division => getDivisionParticipantCount(division.type) > 1);

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border border-card-border bg-dark-gray/25 p-4">
      <div>
        <h4 id={titleId} className="text-sm font-bold text-white">Camisa do evento</h4>
        <p className="mt-0.5 text-xs text-muted">Defina se a camisa já vem no valor da inscrição ou se é um adicional.</p>
      </div>

      <div role="radiogroup" aria-labelledby={titleId} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODE_OPTIONS.map(option => {
          const inputId = `${idPrefix}-shirt-mode-${option.value}`;
          const descriptionId = `${inputId}-description`;
          const checked = mode === option.value;

          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-info ${
                checked ? 'border-primary bg-primary/5' : 'border-card-border bg-dark-gray hover:border-muted'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={`${idPrefix}-shirt-mode`}
                value={option.value}
                checked={checked}
                onChange={() => onModeChange(option.value)}
                aria-describedby={descriptionId}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-bold text-white">{option.label}</span>
                <span id={descriptionId} className="mt-0.5 block text-xs leading-5 text-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-start">
        <div>
          <label htmlFor={priceId} className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
            Valor adicional da camisa ({getCurrencySymbol(currency)})
          </label>
          <input
            ref={priceInputRef}
            id={priceId}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="Ex: 60"
            value={price}
            disabled={!isOptional}
            onChange={(e) => onPriceChange(e.target.value)}
            aria-invalid={Boolean(priceError)}
            aria-describedby={priceError ? `${priceErrorId} ${priceHintId}` : priceHintId}
            className={`w-full rounded-md border bg-dark-gray px-4 py-2 text-sm text-white placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 font-number ${
              priceError ? 'border-trading-down focus:border-trading-down' : 'border-card-border focus:border-primary/50'
            }`}
          />
          {priceError && (
            <p id={priceErrorId} className="mt-1 text-xs font-semibold text-trading-down">{priceError}</p>
          )}
        </div>
        <p id={priceHintId} className="text-xs leading-5 text-muted sm:pt-6">
          {isOptional
            ? 'Cobrado por atleta que escolher camisa. Em duplas e equipes, cada integrante escolhe e paga o próprio adicional.'
            : 'Sem adicional: a camisa já está no valor da inscrição.'}
        </p>
      </div>

      {divisions && (
        <div>
          <p id={previewTitleId} className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Como o atleta verá os valores</p>
          {divisions.length === 0 ? (
            <p className="text-xs text-muted">Cadastre categorias para ver a prévia dos valores.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-card-border">
              <table className="w-full text-left text-xs" aria-labelledby={previewTitleId}>
                <thead>
                  <tr className="border-b border-card-border text-[10px] font-bold uppercase tracking-wider text-muted">
                    <th scope="col" className="px-3 py-2">Categoria</th>
                    {isOptional ? (
                      <>
                        <th scope="col" className="px-3 py-2 text-right">Sem camisa</th>
                        <th scope="col" className="px-3 py-2 text-right">Com camisa</th>
                      </>
                    ) : (
                      <th scope="col" className="px-3 py-2 text-right">Valor (camisa inclusa)</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/40">
                  {divisions.map(division => {
                    const participants = getDivisionParticipantCount(division.type);
                    const prices = getDivisionShirtPrices(division, addonPrice ?? 0);

                    return (
                      <tr key={division.id}>
                        <th scope="row" className="px-3 py-2 font-semibold text-white">
                          {division.name}
                          {participants > 1 && (
                            <span className="ml-1.5 text-[10px] font-normal text-muted-soft">{participants} integrantes</span>
                          )}
                        </th>
                        <td className="px-3 py-2 text-right font-number text-white">{formatEventMoney(prices.withoutShirt, currency)}</td>
                        {isOptional && (
                          <td className="px-3 py-2 text-right font-number font-bold text-primary">
                            {addonPrice === null ? '—' : formatEventMoney(prices.withShirt, currency)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {isOptional ? (
            hasTeams && (
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Equipes: o valor “com camisa” considera todos os integrantes levando camisa. Cada integrante escolhe individualmente.
              </p>
            )
          ) : (
            <p className="mt-2 text-[11px] leading-5 text-muted">Todos os atletas recebem camisa. Nenhum valor adicional é cobrado.</p>
          )}
        </div>
      )}

      {existingRegistrations !== undefined && existingRegistrations > 0 && (
        <div role="note" className="rounded-md border border-info/30 bg-info/10 p-3 text-xs leading-5 text-white">
          <strong>
            {existingRegistrations === 1 ? '1 inscrição já realizada.' : `${existingRegistrations} inscrições já realizadas.`}
          </strong>{' '}
          A alteração vale só para novas inscrições. Quem já se inscreveu mantém o valor e a camisa que escolheu.
        </div>
      )}

      <div role="note" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-5 text-muted-soft">
        A taxa de serviço da plataforma incide sobre o total pago, incluindo a camisa.
      </div>
    </section>
  );
}
