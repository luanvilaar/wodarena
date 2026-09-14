'use client';

import React from 'react';
import { Globe2, ChevronDown } from 'lucide-react';
import { usePathname as useRawPathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { routing, isLocaleExcludedPath } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';
import { toBcp47 } from '@/i18n/locales';
import type { AppLocale } from '@/types';

// Painéis internos (/admin, /owner, /judge) ficam fora do roteamento de
// locale (ver src/proxy.ts) — não existe uma versão prefixada dessas rotas,
// então trocar de idioma ali navegaria para uma URL inexistente (404). O
// seletor também fica oculto se só houver um locale configurado.
export function LocaleSwitcher({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('Nav');
  const pathname = usePathname();
  const rawPathname = useRawPathname();
  const router = useRouter();

  if (routing.locales.length <= 1 || isLocaleExcludedPath(rawPathname)) return null;

  const handleChange = (nextLocale: AppLocale) => {
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <label className={variant === 'mobile' ? 'flex items-center gap-2' : 'flex h-10 items-center gap-1'}>
      <span className="sr-only">{t('language')}</span>
      <Globe2 className="h-4 w-4 text-muted" aria-hidden="true" />
      <select
        value={locale}
        onChange={(event) => handleChange(event.target.value as AppLocale)}
        className="appearance-none bg-transparent text-sm font-semibold text-muted outline-none"
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {toBcp47(loc)}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 text-muted" aria-hidden="true" />
    </label>
  );
}
