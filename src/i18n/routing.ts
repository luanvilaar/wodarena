import { defineRouting } from 'next-intl/routing';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/i18n/locales';

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: true
});

// Painéis internos (fora de src/app/[locale]/) não têm rota localizada —
// mantenha esta lista em sincronia com o matcher de src/proxy.ts, que exclui
// os mesmos segmentos do middleware de i18n.
export const LOCALE_EXCLUDED_ROOTS = ['admin', 'owner', 'judge'] as const;

export const isLocaleExcludedPath = (pathname: string | null | undefined): boolean =>
  Boolean(pathname) && LOCALE_EXCLUDED_ROOTS.some((root) => pathname === `/${root}` || pathname!.startsWith(`/${root}/`));
