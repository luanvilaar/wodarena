'use client';

import React from 'react';
import NextLink from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { isStandalonePanelPath } from '@/lib/panelChrome';
import { readCompanyInfo } from '@/lib/companyInfo';

// Rodapé escuro e curto (Story 1.135, P8 de docs/design/mobile-competitivo/):
// mesmo tema do site, links que levam a lugares diferentes, meios de pagamento
// e os dados da empresa quando configurados por variável de ambiente.
const linkClass = 'flex min-h-11 items-center text-sm text-muted transition-colors hover:text-white';

export function Footer() {
  const t = useTranslations('Footer');
  const currentYear = new Date().getFullYear();
  const pathname = usePathname();
  const company = readCompanyInfo();

  // O /owner tem moldura própria (Story 1.123).
  if (isStandalonePanelPath(pathname)) return null;

  return (
    <footer className="mt-auto border-t border-card-border bg-dark-gray text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-4">
            <Image src="/Ativo_1.svg" alt="WODArena" width={180} height={22} className="h-5 w-auto" />
            <p className="max-w-sm text-sm leading-6 text-muted">{t('tagline')}</p>
            {/* Página para organizadores com o formulário comercial (Story 1.132);
                não é o painel de login. */}
            <Link href="/organizadores" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary hover:underline">
              {t('organizeEvent')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-6 lg:contents">
            <nav aria-labelledby="footer-platform">
              <h2 id="footer-platform" className="text-xs font-bold uppercase tracking-[0.14em] text-white">{t('platformHeading')}</h2>
              <div className="mt-2 flex flex-col">
                <Link href="/" className={linkClass}>{t('eventsLink')}</Link>
                <Link href="/organizadores" className={linkClass}>{t('organizersLink')}</Link>
                <Link href="/ajuda" className={linkClass}>{t('helpLink')}</Link>
              </div>
            </nav>

            <nav aria-labelledby="footer-athlete">
              <h2 id="footer-athlete" className="text-xs font-bold uppercase tracking-[0.14em] text-white">{t('athleteHeading')}</h2>
              <div className="mt-2 flex flex-col">
                <NextLink href="/admin#inscricoes" className={linkClass}>{t('myRegistrationsLink')}</NextLink>
                <NextLink href="/admin" className={linkClass}>{t('signInLink')}</NextLink>
              </div>
            </nav>
          </div>
        </div>

        <div className="mt-8 space-y-3 border-t border-card-border pt-6 text-xs leading-5 text-muted">
          <p className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-trading-up" aria-hidden="true" />
            {t('paymentMethods')}
          </p>
          {company.legalName && (
            <p>{company.cnpj ? t('companyLine', { name: company.legalName, cnpj: company.cnpj }) : company.legalName}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>{t('copyright', { year: currentYear })}</p>
            <div className="flex flex-wrap gap-x-6">
              <Link href="/termos" className="flex min-h-11 items-center transition-colors hover:text-white">
                {t('termsLink')}
              </Link>
              <Link href="/termos#privacidade" className="flex min-h-11 items-center transition-colors hover:text-white">
                {t('privacyLink')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
