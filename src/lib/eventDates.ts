// Datas estruturadas do evento (Story 1.71): validação na escrita, rótulo em
// texto para a coluna `date` e a data curta do card. Sem imports de runtime,
// para os testes poderem transpilar o módulo sozinho.

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const PT_MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

type IsoParts = { year: number; month: number; day: number };

const readIsoParts = (value: unknown): IsoParts | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(ISO_DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? { year, month, day }
    : null;
};

export const isIsoDate = (value: unknown): value is string => readIsoParts(value) !== null;

export type EventDatesWrite =
  | { ok: true; startDate: string | null; endDate: string | null }
  | { ok: false; error: string };

/**
 * Valida start_date/end_date vindos do painel. Os dois andam juntos: datas
 * válidas (YYYY-MM-DD) com fim igual ou depois do início, ou null nos dois.
 */
export function resolveEventDatesForWrite(row: Record<string, unknown>): EventDatesWrite {
  const start = row.start_date ?? null;
  const end = row.end_date ?? null;

  if (start === null && end === null) return { ok: true, startDate: null, endDate: null };
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return { ok: false, error: 'Informe a data de início e a de término do evento.' };
  }
  const startDate = start.trim();
  const endDate = end.trim();
  if (endDate < startDate) {
    return { ok: false, error: 'A data de término não pode ser antes da data de início.' };
  }
  return { ok: true, startDate, endDate };
}

/**
 * Rótulo em português para a coluna `date` quando o gestor deixa o texto em
 * branco: "31 de outubro de 2026", "17 e 18 de outubro de 2026",
 * "5 a 20 de outubro de 2026", "30 de outubro a 1 de novembro de 2026".
 */
export function buildEventDateLabel(startDate: string, endDate: string): string {
  const start = readIsoParts(startDate);
  const end = readIsoParts(endDate) ?? start;
  if (!start || !end) return '';

  const full = (parts: IsoParts) => `${parts.day} de ${PT_MONTHS[parts.month]} de ${parts.year}`;
  if (startDate === endDate) return full(start);

  if (start.year === end.year && start.month === end.month) {
    const joiner = end.day - start.day === 1 ? 'e' : 'a';
    return `${start.day} ${joiner} ${end.day} de ${PT_MONTHS[end.month]} de ${end.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} de ${PT_MONTHS[start.month]} a ${full(end)}`;
  }
  return `${full(start)} a ${full(end)}`;
}

export type EventDateForm =
  | { ok: true; startDate: string; endDate: string; label: string }
  | { ok: false; error: string };

/**
 * Campos de data do painel: início obrigatório, término vazio vale o início,
 * e o texto exibido, se vazio, é gerado das datas.
 */
export function resolveEventDateForm(input: { startDate: string; endDate: string; label: string }): EventDateForm {
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim() || startDate;
  if (!isIsoDate(startDate)) return { ok: false, error: 'Informe a data de início do evento.' };
  if (!isIsoDate(endDate)) return { ok: false, error: 'Informe uma data de término válida.' };
  if (endDate < startDate) return { ok: false, error: 'A data de término não pode ser antes da data de início.' };
  return { ok: true, startDate, endDate, label: input.label.trim() || buildEventDateLabel(startDate, endDate) };
}

const intlLocale = (locale: string) => {
  const [language, region] = locale.split('-');
  return region ? `${language}-${region.toUpperCase()}` : language;
};

const formatPart = (parts: IsoParts, locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' })
    .format(new Date(Date.UTC(parts.year, parts.month, parts.day)))
    .replace(/\.$/, '');

/**
 * Data curta do card, no idioma da página: "sáb, 31 out 2026" (um dia),
 * "17–18 out 2026", "30 out – 1 nov 2026", "30 dez 2026 – 2 jan 2027".
 */
export function formatEventDateRange(
  startDate: string,
  endDate: string,
  locale: string,
  { withWeekday = true }: { withWeekday?: boolean } = {},
): string {
  const start = readIsoParts(startDate);
  const end = readIsoParts(endDate) ?? start;
  if (!start || !end) return '';

  const month = (parts: IsoParts) => formatPart(parts, locale, { month: 'short' });
  const dayMonthYear = (parts: IsoParts) => `${parts.day} ${month(parts)} ${parts.year}`;

  if (startDate === endDate) {
    if (!withWeekday) return dayMonthYear(start);
    return `${formatPart(start, locale, { weekday: 'short' })}, ${dayMonthYear(start)}`;
  }
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${month(end)} ${end.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${month(start)} – ${dayMonthYear(end)}`;
  }
  return `${dayMonthYear(start)} – ${dayMonthYear(end)}`;
}
