// Dados e regras da frente do comprovante (Story 1.75), o pôster tipográfico
// aprovado em docs/design/comprovante/. Módulo puro: o mesmo modelo alimenta a
// imagem dos Stories, o cabeçalho do e-mail e o verso do comprovante no app.
import type { AppLocale, Athlete, Event, Registration } from '@/types';
import { formatEventDateRange } from './eventDates';

export type PosterFormat = 'story' | 'email';

export const POSTER_SIZES: Record<PosterFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  email: { width: 1200, height: 600 }
};

type PosterCopy = {
  confirmed: string;
  teamConfirmed: string;
  category: string;
  date: string;
  box: string;
  viaPlatform: string;
  boxFallback: string;
};

export const POSTER_COPY: Record<AppLocale, PosterCopy> = {
  'pt-br': {
    confirmed: 'Inscrição confirmada',
    teamConfirmed: 'Equipe confirmada',
    category: 'Categoria',
    date: 'Data',
    box: 'Box',
    viaPlatform: 'inscrição via WODArena',
    boxFallback: 'Independente'
  },
  'pt-pt': {
    confirmed: 'Inscrição confirmada',
    teamConfirmed: 'Equipa confirmada',
    category: 'Categoria',
    date: 'Data',
    box: 'Box',
    viaPlatform: 'inscrição via WODArena',
    boxFallback: 'Independente'
  },
  'en-gb': {
    confirmed: 'Registration confirmed',
    teamConfirmed: 'Team confirmed',
    category: 'Category',
    date: 'Date',
    box: 'Box',
    viaPlatform: 'registered via WODArena',
    boxFallback: 'Independent'
  }
};

const BCP47: Record<AppLocale, string> = { 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', 'en-gb': 'en-GB' };

export const resolvePosterLocale = (value: unknown): AppLocale => (
  value === 'pt-pt' || value === 'en-gb' || value === 'pt-br' ? value : 'pt-br'
);

// Só inscrição com pagamento aprovado ganha a frente; pendente e em análise ficam
// só com o registro (verso). Sem status gravado conta como aprovada, como no comprovante.
export const isPosterEligible = (registration: Pick<Registration, 'paymentStatus'>): boolean => (
  (registration.paymentStatus || 'payment_approved') === 'payment_approved'
);

// O nome composto das equipes chega como "Equipe (Integrante 1 / Integrante 2)".
export const stripTeamSuffix = (name: string): string => name.replace(/\s*\([^()]*\)\s*$/, '').trim();

const MAX_LINE_CHARS = 20;

const clampLine = (line: string): string => (
  line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : line
);

// Pessoa: primeiro e último nome (o nome inteiro fica no verso). Equipe: o nome do
// time em até duas linhas, quebrando onde as linhas ficam mais parecidas.
export const splitPosterName = (rawName: string, isTeam: boolean): string[] => {
  const words = rawName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  if (words.length === 1) return [clampLine(words[0])];
  if (!isTeam) return [clampLine(words[0]), clampLine(words[words.length - 1])];
  if (words.length === 2) return words.map(clampLine);

  let best = 1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const gap = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  }
  return [clampLine(words.slice(0, best).join(' ')), clampLine(words.slice(best).join(' '))];
};

// Anton é condensada (~0,48 de largura por altura de caixa em maiúsculas): o corpo
// cabe a linha mais longa na largura útil, entre um piso legível e um teto.
export const posterNameFontSize = (lines: string[], availableWidth: number, { max, min }: { max: number; min: number }): number => {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const fitted = Math.floor(availableWidth / (longest * 0.5));
  return Math.max(min, Math.min(max, fitted));
};

export const toInstagramHandle = (value?: string | null): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const handle = raw
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .split(/[/?#\s]/)[0];
  return handle ? `@${handle}` : '';
};

export const getEventInitials = (eventName: string): string => {
  const letters = eventName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]);
  return (letters.join('') || 'WA').toUpperCase();
};

export const getEventDateLabel = (
  event: Pick<Event, 'date' | 'startDate' | 'endDate'>,
  locale: AppLocale
): string => {
  if (event.startDate && event.endDate) {
    const label = formatEventDateRange(event.startDate, event.endDate, BCP47[locale], { withWeekday: false });
    if (label) return label;
  }
  return String(event.date || '').trim();
};

export type PaymentMethodKind = 'free' | 'pix' | 'card' | 'other';

// payment_method guarda o texto do gateway: 'free', 'pix', a bandeira do cartão
// ('visa', 'master', 'elo'...) ou 'credit_card' / 'mercadopago_preference'.
export const getPaymentMethodKind = (method?: string | null): PaymentMethodKind | null => {
  const value = String(method || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'free') return 'free';
  if (value === 'pix' || value === 'bank_transfer') return 'pix';
  if (/(card|credit|debit|visa|master|elo|amex|hiper|diners|cabal)/.test(value)) return 'card';
  return 'other';
};

export type RegistrationPosterModel = {
  locale: AppLocale;
  copy: PosterCopy;
  eventName: string;
  eventInitials: string;
  displayName: string;
  isTeam: boolean;
  lines: string[];
  ghostTop: string[];
  ghostBottom: string[];
  members: string[];
  confirmedLabel: string;
  categoryName: string;
  dateLabel: string;
  box: string;
  instagramHandle: string;
};

export const buildPosterModel = (params: {
  registration: Pick<Registration, 'athleteName' | 'ticketType' | 'box' | 'locale'>;
  athlete: Pick<Athlete, 'isTeam' | 'teamMembers'>;
  event: Pick<Event, 'name' | 'date' | 'startDate' | 'endDate' | 'instagram' | 'defaultLocale'>;
  locale?: AppLocale | string | null;
}): RegistrationPosterModel => {
  const { registration, athlete, event } = params;
  const locale = resolvePosterLocale(params.locale ?? registration.locale ?? event.defaultLocale);
  const copy = POSTER_COPY[locale];
  const isTeam = Boolean(athlete.isTeam);
  const displayName = isTeam ? stripTeamSuffix(registration.athleteName) : registration.athleteName.trim();
  const lines = splitPosterName(displayName, isTeam);
  const members = isTeam
    ? (athlete.teamMembers ?? []).map((member) => String(member.name || '').trim()).filter(Boolean)
    : [];

  return {
    locale,
    copy,
    eventName: String(event.name || '').trim() || 'WODArena',
    eventInitials: getEventInitials(String(event.name || '')),
    displayName,
    isTeam,
    lines,
    // A primeira linha repete apagada duas vezes acima e a última duas abaixo.
    ghostTop: [lines[0], lines[0]],
    ghostBottom: [lines[lines.length - 1], lines[lines.length - 1]],
    members,
    confirmedLabel: isTeam ? copy.teamConfirmed : copy.confirmed,
    categoryName: String(registration.ticketType || '').trim(),
    dateLabel: getEventDateLabel(event, locale),
    box: String(registration.box || '').trim() || copy.boxFallback,
    instagramHandle: toInstagramHandle(event.instagram)
  };
};
