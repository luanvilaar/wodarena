'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-hairline-light bg-surface-soft-light text-ink">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 border-b border-hairline-light pb-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <BrandLogo variant="full" className="h-32 w-32 rounded-sm" />
            <p className="max-w-sm text-sm leading-6 text-muted-soft">
              A infraestrutura de inscrições, rankings e operação para competições de Functional Fitness.
            </p>
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink transition-colors hover:text-[#a87f00]">
              Organize seu evento <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">Plataforma</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <Link href="/" className="transition-colors hover:text-ink">Eventos</Link>
              <Link href="/admin" className="transition-colors hover:text-ink">Organizadores</Link>
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">Recursos</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <a href="#eventos" className="transition-colors hover:text-ink">Inscrições</a>
              <a href="#eventos" className="transition-colors hover:text-ink">Leaderboards</a>
              <a href="#eventos" className="transition-colors hover:text-ink">Cronogramas</a>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">Operação</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-soft">
              <span>Atualização em tempo real</span>
              <span>Pagamentos sandbox</span>
              <span>Suporte para boxes</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 pt-6 text-xs text-muted-soft sm:flex-row sm:items-center">
          <p>© {currentYear} WODArena. Todos os direitos reservados.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/termos" className="transition-colors hover:text-ink">
              Termos e Políticas de Compra
            </Link>
            <Link href="/termos#privacidade" className="transition-colors hover:text-ink">
              Políticas de Privacidade
            </Link>
          </div>
          <p>Feito para arenas, boxes e atletas.</p>
        </div>
      </div>
    </footer>
  );
}
