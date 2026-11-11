'use client';

import React, { useState } from 'react';
import NextLink from 'next/link';
import Image from 'next/image';
import { Calendar, LayoutDashboard, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { isStandalonePanelPath } from '@/lib/panelChrome';
import { shouldShowBottomNav } from '@/lib/bottomNav';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

export function Navbar() {
  const t = useTranslations('Nav');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const pathname = usePathname();

  const closeMenu = () => setIsMenuOpen(false);

  // O /owner tem moldura própria (Story 1.123).
  if (isStandalonePanelPath(pathname)) return null;

  // Nas páginas públicas o celular navega pela barra do rodapé (Story 1.129):
  // o topo fica com logotipo e idioma, sem o menu ☰.
  const hasBottomNav = shouldShowBottomNav(pathname);

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Um logotipo só: o selo quadrado repetia o wordmark (Story 1.127). */}
          <Link href="/" className="flex min-h-11 min-w-0 items-center" onClick={closeMenu} aria-label={t('homeAriaLabel')}>
            <Image
              src="/Ativo_1.svg"
              alt="WODArena"
              width={162}
              height={20}
              priority
              className="h-5 w-auto object-contain shrink-0"
            />
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label={t('mainNavigation')}>
            <Link
              href="/"
              className="flex h-10 items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-white"
            >
              <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{t('events')}</span>
            </Link>

            <LocaleSwitcher />

            {/* /admin é o painel interno, fora do escopo de i18n — usa o Link do next/link puro para nunca ganhar prefixo de locale */}
            <NextLink
              href="/admin"
              className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <span>{t('adminPanel')}</span>
            </NextLink>
          </nav>

          {hasBottomNav ? (
            <div className="flex min-h-11 items-center md:hidden">
              <LocaleSwitcher variant="mobile" />
            </div>
          ) : (
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-card-border bg-card text-white transition-colors hover:border-primary md:hidden"
              aria-label={isMenuOpen ? t('closeMenu') : t('openMenu')}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              {isMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>

      {isMenuOpen && !hasBottomNav && (
        <nav className="border-t border-card-border bg-background px-4 py-5 md:hidden" aria-label={t('mobileNavigation')}>
          <div className="mx-auto flex max-w-7xl flex-col gap-2">
            <Link href="/" onClick={closeMenu} className="flex h-12 items-center gap-3 rounded-md px-3 text-sm font-semibold text-white hover:bg-card">
              <Calendar className="h-4 w-4 text-primary" aria-hidden="true" /> {t('events')}
            </Link>

            <div className="px-3 py-2">
              <LocaleSwitcher variant="mobile" />
            </div>

            <NextLink href="/admin" onClick={closeMenu} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-ink hover:bg-primary-hover">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> {t('adminPanel')}
            </NextLink>
          </div>
        </nav>
      )}
    </header>
  );
}
