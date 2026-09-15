'use client';

import React from 'react';
import NextLink from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function Footer() {
  const t = useTranslations('Footer');
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-hairline-light bg-surface-soft-light text-ink">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 border-b border-hairline-light pb-12 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <img
              src="/Ativo4.svg"
              alt="WODArena"
              width={160}
              height={111}
              className="h-32 w-32 object-contain"
            />
            <p className="max-w-sm text-sm leading-6 text-muted-soft-on-light">
              {t('tagline')}
            </p>
            {/* Leva à home e abre o modal de captação de leads (mesmo formulário
                do CTA "Quero ser gestor" do banner) — não é o painel de login. */}
            <Link href="/?organizar=1" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink transition-colors hover:text-[#a87f00]">
              {t('organizeEvent')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('platformHeading')}</h2>
            <div className="mt-3 flex flex-col gap-1 text-sm text-muted-soft-on-light">
              <Link href="/" className="py-2 transition-colors hover:text-ink">{t('eventsLink')}</Link>
              <NextLink href="/admin" className="py-2 transition-colors hover:text-ink">{t('organizersLink')}</NextLink>
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('resourcesHeading')}</h2>
            <div className="mt-3 flex flex-col gap-1 text-sm text-muted-soft-on-light">
              {/* As três seções abaixo do link para a mesma âncora da home (#eventos)
                  — ainda não existem páginas dedicadas para cada uma. Usar o Link
                  do i18n em vez de <a href> garante que o link funcione a partir de
                  qualquer página, não só da home. */}
              <Link href="/#eventos" className="py-2 transition-colors hover:text-ink">{t('registrationsLink')}</Link>
              <Link href="/#eventos" className="py-2 transition-colors hover:text-ink">{t('leaderboardsLink')}</Link>
              <Link href="/#eventos" className="py-2 transition-colors hover:text-ink">{t('schedulesLink')}</Link>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t('operationHeading')}</h2>
            {/* Itens informativos, não navegação: sem cor/hover de link para não
                prometer um clique que essas linhas não têm. */}
            <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-soft-on-light">
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft-on-light/50" aria-hidden="true" />
                {t('realtimeUpdates')}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft-on-light/50" aria-hidden="true" />
                {t('sandboxPayments')}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 shrink-0 rounded-full bg-muted-soft-on-light/50" aria-hidden="true" />
                {t('boxSupport')}
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 pt-6 text-xs text-muted-soft-on-light sm:flex-row sm:items-center">
          <p>{t('copyright', { year: currentYear })}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/termos" className="py-1 transition-colors hover:text-ink">
              {t('termsLink')}
            </Link>
            <Link href="/termos#privacidade" className="py-1 transition-colors hover:text-ink">
              {t('privacyLink')}
            </Link>
          </div>
          <p>{t('madeFor')}</p>
        </div>
      </div>
    </footer>
  );
}
