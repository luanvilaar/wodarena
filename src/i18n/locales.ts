import type { AppLocale, EventCountryCode } from '@/types';

export const SUPPORTED_LOCALES: AppLocale[] = ['pt-br', 'en-gb', 'pt-pt'];
export const DEFAULT_LOCALE: AppLocale = 'pt-br';

const BCP47_BY_LOCALE: Record<AppLocale, string> = {
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-PT',
  'en-gb': 'en-GB'
};

const OG_LOCALE_BY_LOCALE: Record<AppLocale, string> = {
  'pt-br': 'pt_BR',
  'pt-pt': 'pt_PT',
  'en-gb': 'en_GB'
};

const COUNTRY_BY_LOCALE: Record<AppLocale, EventCountryCode> = {
  'pt-br': 'BR',
  'pt-pt': 'PT',
  'en-gb': 'GB'
};

export const isSupportedLocale = (value: unknown): value is AppLocale =>
  typeof value === 'string' && (SUPPORTED_LOCALES as string[]).includes(value);

export const toBcp47 = (locale: AppLocale): string => BCP47_BY_LOCALE[locale] ?? BCP47_BY_LOCALE[DEFAULT_LOCALE];

export const toOgLocale = (locale: AppLocale): string => OG_LOCALE_BY_LOCALE[locale] ?? OG_LOCALE_BY_LOCALE[DEFAULT_LOCALE];

export const localeToCountry = (locale: AppLocale): EventCountryCode => COUNTRY_BY_LOCALE[locale] ?? 'BR';
