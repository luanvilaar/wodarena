'use client';

import React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarDays, LayoutDashboard, LogIn, Radio, Ticket, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useApp } from '@/context/AppContext';
import { getEventStatus } from '@/lib/eventStatus';
import {
  REGISTRATIONS_HREF,
  getAccountDestination,
  getActiveBottomTab,
  getLiveHref,
  shouldShowBottomNav,
} from '@/lib/bottomNav';

// Barra de navegação no rodapé do celular (Story 1.129, P1 de
// docs/design/mobile-competitivo/). Some a partir de 768 px, no painel, no
// telão e na prévia da súmula.
const itemClass =
  'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold leading-none transition-colors';

export function BottomNav() {
  const t = useTranslations('Nav');
  const pathname = usePathname();
  const { events, currentUser } = useApp();

  if (!shouldShowBottomNav(pathname)) return null;

  const active = getActiveBottomTab(pathname);
  const liveIds = events
    .filter((event) => event.status === 'live' && getEventStatus(event) !== 'finished')
    .map((event) => event.id);
  const liveHref = getLiveHref(liveIds);
  const account = getAccountDestination(currentUser?.role);
  const AccountIcon = account.label === 'tabSignIn' ? LogIn : account.label === 'tabAccount' ? UserRound : LayoutDashboard;
  const tone = (tab: string) => (active === tab ? 'text-primary' : 'text-muted hover:text-white');

  return (
    <>
      {/* Reserva o espaço da barra para o fim da página não ficar escondido. */}
      <div aria-hidden="true" className="h-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={t('bottomNavigation')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          <Link href="/" aria-current={active === 'events' ? 'page' : undefined} className={`${itemClass} ${tone('events')}`}>
            <CalendarDays className="h-6 w-6" aria-hidden="true" />
            <span>{t('tabEvents')}</span>
          </Link>

          <Link
            href={liveHref.startsWith('/event/') ? liveHref : { pathname: '/', query: { status: 'live' }, hash: 'eventos' }}
            aria-current={active === 'live' ? 'page' : undefined}
            aria-label={liveIds.length > 0 ? `${t('tabLive')}, ${t('liveCount', { count: liveIds.length })}` : undefined}
            className={`${itemClass} ${tone('live')}`}
          >
            <Radio className="h-6 w-6" aria-hidden="true" />
            {liveIds.length > 0 && (
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1.5 ml-1.5 min-w-[18px] rounded-full bg-trading-down px-1 text-center font-number text-[10px] font-bold leading-[18px] text-ink"
              >
                {liveIds.length}
              </span>
            )}
            <span>{t('tabLive')}</span>
          </Link>

          <NextLink href={REGISTRATIONS_HREF} className={`${itemClass} ${tone('registrations')}`}>
            <Ticket className="h-6 w-6" aria-hidden="true" />
            <span>{t('tabRegistrations')}</span>
          </NextLink>

          <NextLink href={account.href} className={`${itemClass} ${tone('account')}`}>
            <AccountIcon className="h-6 w-6" aria-hidden="true" />
            <span>{t(account.label)}</span>
          </NextLink>
        </div>
      </nav>
    </>
  );
}
