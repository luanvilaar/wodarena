'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, LogOut } from 'lucide-react';

import { useApp } from '@/context/AppContext';

// Moldura da arbitragem na quadra (Story 1.49): tema claro de alto contraste
// (decisão 9 da E3, classe court-light em globals.css), cabeçalho fixo com
// voltar e sair, e a guarda de acesso (judge, gestor ou owner). O servidor
// confere o acesso de novo em cada chamada.

const ALLOWED = new Set(['judge', 'manager', 'owner']);

type CourtShellProps = {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
  children: ReactNode;
};

export function CourtShell({ title, subtitle, back, children }: CourtShellProps) {
  const { currentUser, isSessionHydrated, logout } = useApp();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace('/admin');
  };

  let content = children;
  if (!isSessionHydrated) {
    content = <p className="py-16 text-center text-sm font-semibold text-muted" role="status">Carregando…</p>;
  } else if (!currentUser || !ALLOWED.has(currentUser.role)) {
    content = (
      <div className="space-y-3 py-16 text-center">
        <h2 className="text-xl font-extrabold">Acesso restrito à arbitragem</h2>
        <p className="text-sm text-muted">Entre com a conta de judge que o gestor do evento criou para você.</p>
        <Link href="/admin" className="inline-flex min-h-11 items-center rounded-md border border-card-border px-4 text-sm font-bold underline-offset-4 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="court-light min-h-screen">
      <header className="sticky top-0 z-30 border-b border-card-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {back && (
              <Link
                href={back.href}
                aria-label={back.label}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-card-border bg-dark-gray hover:border-primary"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Arbitragem na quadra</p>
              <h1 className="truncate text-lg font-extrabold leading-tight">{title}</h1>
              {subtitle && <p className="truncate text-xs font-semibold text-muted">{subtitle}</p>}
            </div>
          </div>
          {currentUser && (
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair da conta"
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold uppercase tracking-wider text-muted hover:border-trading-down hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sair
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{content}</main>
    </div>
  );
}
