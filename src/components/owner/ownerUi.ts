import type { EventCurrency } from '@/types';
import { formatMoney } from '@/lib/intl/format';
import type { OwnerCurrencyTotals, OwnerTone } from '@/lib/ownerFinance';

// Formatação e cores compartilhadas pelas seções do painel do proprietário
// (Stories 1.120 a 1.126, docs/design/painel-proprietario/). Todo dinheiro sai de
// formatMoney, na moeda do evento.

export const formatOwnerMoney = (amount: number, currency: EventCurrency = 'BRL') => formatMoney(amount, currency, 'pt-br');

/** Um valor por moeda ("R$ 1.200,00 · € 300,00"); sem movimento, R$ 0,00. */
export const formatMoneyByCurrency = (money: OwnerCurrencyTotals[], field: 'collected' | 'serviceFee' | 'netRevenue') =>
  money.length === 0 ? formatOwnerMoney(0) : money.map(item => formatOwnerMoney(item[field], item.currency)).join(' · ');

export const formatOwnerInteger = (value: number) => new Intl.NumberFormat('pt-BR').format(value);

export const formatOwnerDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(date);
};

export const OWNER_TONE_CLASSES: Record<OwnerTone, string> = {
  ok: 'bg-primary/10 text-primary',
  warn: 'bg-amber-400/10 text-amber-300',
  crit: 'bg-red-950/30 text-red-300',
  mute: 'bg-dark-gray text-muted'
};

export const ownerCardClassName = 'rounded-xl border border-card-border bg-card p-4 sm:p-5';
