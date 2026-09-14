'use client';

import React from 'react';
import NextLink from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function Footer() {
  const t = useTranslations('Footer');
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-hairline-light bg-surface-soft-light text-ink">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 border-b border-hairline-light pb-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <Image
              src="/logo-preta.png"
              alt="WODArena"
              width={160}
              height={112}
              className="h-32 w-32 rounded-sm object-contain"
            />
            <p className="max-w-sm text-sm leading-6 text-muted-soft">
              {t('tagline')}
            </p>
            {/* /admin é o painel interno, fora do escopo de i18n — usa o Link do next/link puro para nunca ganhar prefixo de locale */}
            <NextLink href="/admin" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink transition-colors hover:text-[#a87f00]">
              {t('organizeEvent')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </NextLink>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('platformHeading')}</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <Link href="/" className="transition-colors hover:text-ink">{t('eventsLink')}</Link>
              <NextLink href="/admin" className="transition-colors hover:text-ink">{t('organizersLink')}</NextLink>
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('resourcesHeading')}</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <a href="#eventos" className="transition-colors hover:text-ink">{t('registrationsLink')}</a>
              <a href="#eventos" className="transition-colors hover:text-ink">{t('leaderboardsLink')}</a>
              <a href="#eventos" className="transition-colors hover:text-ink">{t('schedulesLink')}</a>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('operationHeading')}</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <span>{t('realtimeUpdates')}</span>
              <span>{t('sandboxPayments')}</span>
              <span>{t('boxSupport')}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 pt-6 text-xs text-muted-soft sm:flex-row sm:items-center">
          <p>{t('copyright', { year: currentYear })}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/termos" className="transition-colors hover:text-ink">
              {t('termsLink')}
            </Link>
            <Link href="/termos#privacidade" className="transition-colors hover:text-ink">
              {t('privacyLink')}
            </Link>
          </div>
          <p>{t('madeFor')}</p>
        </div>
      </div>
    </footer>
  );
}
