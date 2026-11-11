// Barra de navegação no rodapé do celular (Story 1.129, P1 do comparativo
// mobile em docs/design/mobile-competitivo/). Regras puras: onde a barra
// aparece, qual destino está ativo e para onde cada destino leva.

import { isLocaleExcludedPath } from '@/i18n/routing';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

export type BottomNavTab = 'events' | 'live' | 'registrations' | 'account';
export type BottomNavAccountLabel = 'tabSignIn' | 'tabAccount' | 'tabPanel';
export type BottomNavRole = 'owner' | 'manager' | 'athlete' | 'judge';

// Rotas públicas que ocupam a tela inteira: o telão vai para a TV e a prévia
// da súmula imita o aparelho do judge.
const FULLSCREEN_SEGMENTS = ['telao', 'sumula-preview'];

// Caminho sem o prefixo de idioma ("/pt-br/event/x" -> "/event/x").
export function stripLocalePrefix(pathname: string): string {
  const [, first, ...rest] = pathname.split('/');
  if (first && (SUPPORTED_LOCALES as string[]).includes(first)) {
    return `/${rest.join('/')}`.replace(/\/+$/, '') || '/';
  }
  return pathname.replace(/\/+$/, '') || '/';
}

export function shouldShowBottomNav(pathname: string | null | undefined): boolean {
  if (!pathname || isLocaleExcludedPath(pathname)) return false;
  const [, segment] = stripLocalePrefix(pathname).split('/');
  return !FULLSCREEN_SEGMENTS.includes(segment ?? '');
}

export function getActiveBottomTab(pathname: string | null | undefined): BottomNavTab | null {
  if (!pathname) return null;
  const path = stripLocalePrefix(pathname);
  if (/^\/event\/[^/]+\/leaderboard$/.test(path)) return 'live';
  if (path === '/' || /^\/event\/[^/]+$/.test(path)) return 'events';
  return null;
}

// Com um evento ao vivo, o atleta quer o ranking dele; com zero ou vários, a
// home já filtrada em "Ao vivo".
export function getLiveHref(liveEventIds: readonly string[]): string {
  return liveEventIds.length === 1 ? `/event/${liveEventIds[0]}/leaderboard` : '/?status=live#eventos';
}

// O 4º destino segue a sessão: entrar, a conta do atleta ou o painel do papel.
export function getAccountDestination(role: BottomNavRole | null | undefined): { label: BottomNavAccountLabel; href: string } {
  switch (role) {
    case 'athlete':
      return { label: 'tabAccount', href: '/admin#perfil' };
    case 'owner':
      return { label: 'tabPanel', href: '/owner' };
    case 'judge':
      return { label: 'tabPanel', href: '/judge' };
    case 'manager':
      return { label: 'tabPanel', href: '/admin' };
    default:
      return { label: 'tabSignIn', href: '/admin' };
  }
}

export const REGISTRATIONS_HREF = '/admin#inscricoes';
