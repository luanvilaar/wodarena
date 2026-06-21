export const MANAGER_EXPIRING_SOON_DAYS = 7;

export type ManagerAccessStatus = 'active' | 'expired' | 'expiring_soon' | 'unconfigured';

const BUSINESS_TIME_ZONE = 'America/Fortaleza';
const SERVICE_VALID_UNTIL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatBusinessDatePart = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};

export const getCurrentBusinessDate = () => formatBusinessDatePart(new Date());

export const normalizeServiceValidUntil = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.slice(0, 10);
  if (!SERVICE_VALID_UNTIL_PATTERN.test(normalized)) return undefined;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return normalized;
};

export const addDaysToDateString = (value: string, days: number) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

export const getManagerAccessStatus = (
  serviceValidUntil?: string | null,
  nowDate: string = getCurrentBusinessDate()
): ManagerAccessStatus => {
  const normalizedDate = normalizeServiceValidUntil(serviceValidUntil);
  if (!normalizedDate) return 'unconfigured';
  if (normalizedDate < nowDate) return 'expired';
  if (normalizedDate <= addDaysToDateString(nowDate, MANAGER_EXPIRING_SOON_DAYS)) {
    return 'expiring_soon';
  }
  return 'active';
};

export const isManagerAccessBlocked = (status?: ManagerAccessStatus | null) => status === 'expired';

export const getManagerAccessStatusLabel = (status?: ManagerAccessStatus | null) => {
  if (status === 'active') return 'Ativo';
  if (status === 'expired') return 'Expirado';
  if (status === 'expiring_soon') return 'Vence em breve';
  return 'Sem configuracao';
};
