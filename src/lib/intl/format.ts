import type { AppLocale, EventCurrency } from '@/types';
import { toBcp47 } from '@/i18n/locales';

// Moeda é sempre a do evento, nunca a do visitante — não há conversão cambial
// aqui. O que varia com o locale é só o formato do número (separador decimal,
// posição do símbolo), não o valor exibido.
export const formatMoney = (
  amount: number,
  currency: EventCurrency,
  locale: AppLocale,
  options: { showCode?: boolean } = {}
): string => {
  const formatter = new Intl.NumberFormat(toBcp47(locale), {
    style: 'currency',
    currency,
    currencyDisplay: options.showCode ? 'code' : 'symbol'
  });
  return formatter.format(amount);
};

export const formatEventDate = (iso: string, locale: AppLocale, timeZone: string): string =>
  new Intl.DateTimeFormat(toBcp47(locale), {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone
  }).format(new Date(iso));

export const formatEventDateTime = (iso: string, locale: AppLocale, timeZone: string): string =>
  new Intl.DateTimeFormat(toBcp47(locale), {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  }).format(new Date(iso));

export const formatShortDate = (iso: string, locale: AppLocale, timeZone: string): string =>
  new Intl.DateTimeFormat(toBcp47(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone
  }).format(new Date(iso));

// Todas as moedas suportadas hoje (BRL/EUR/GBP) têm 2 casas decimais, mas o
// helper trata o caso geral via Intl para não virar dívida se isso mudar.
const minorUnitDigits = (currency: EventCurrency, locale: AppLocale): number => {
  const parts = new Intl.NumberFormat(toBcp47(locale), { style: 'currency', currency }).resolvedOptions();
  return parts.maximumFractionDigits ?? 2;
};

export const toMinorUnits = (amount: number, currency: EventCurrency, locale: AppLocale = 'pt-br'): number => {
  const digits = minorUnitDigits(currency, locale);
  return Math.round((amount + Number.EPSILON) * 10 ** digits);
};

export const fromMinorUnits = (amount: number, currency: EventCurrency, locale: AppLocale = 'pt-br'): number => {
  const digits = minorUnitDigits(currency, locale);
  return amount / 10 ** digits;
};
